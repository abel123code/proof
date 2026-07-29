# proof render service — Express + Remotion (headless chromium) + ffmpeg.
# System dependencies for chrome-headless-shell and FFmpeg on a clean Debian worker.
FROM node:22-bookworm-slim

# `unzip` is REQUIRED: hyperframes extracts its chrome-headless-shell download with a system zip
# archiver. Without it the download fails ("no zip archiver is available"), hyperframes finds no
# browser, and EVERY premium scene crashes -> the render ships the caption-only base with 0 bespoke
# animations. Do not remove.
RUN apt-get update -y && apt-get install -y --no-install-recommends \
    ffmpeg \
    unzip \
    libnss3 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 \
    libasound2 libpango-1.0-0 libcairo2 fonts-liberation \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN chown node:node /app

# Chromium refuses its sandbox as root, so build node_modules, the browser
# download, and the runtime all as the unprivileged node user.
USER node

# npm ci must include devDependencies: `npm run server` is `tsx src/server.ts`
# and tsx is a devDependency. Do NOT set NODE_ENV=production before this line.
# --include=dev makes that invariant explicit even if NODE_ENV=production or an
# npm `omit` config leaks into the build environment (e.g. via a base image or
# platform default) — without it, npm silently skips devDependencies and tsx
# would be missing at runtime.
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --include=dev

# Pre-warm chrome-headless-shell so the first render doesn't cold-download it.
# BOTH renderers need their OWN browser and they do NOT share one:
#   remotion    -> /app/node_modules/.remotion/chrome-headless-shell/...  (captions/overlay layer)
#   hyperframes -> /home/node/.cache/hyperframes/chrome/...               (premium bespoke scenes)
# Only remotion was pre-warmed, so hyperframes cold-downloaded Chrome on every render, failed inside
# the container, and EVERY premium scene crashed -> videos shipped with 0 bespoke animations. Baking
# both at build time also removes a runtime network dependency mid-render.
RUN npx remotion browser ensure
RUN npx hyperframes browser ensure

COPY --chown=node:node . .

EXPOSE 8080
CMD ["npm", "run", "server"]

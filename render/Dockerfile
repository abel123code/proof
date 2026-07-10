# proof render service — Express + Remotion (headless chromium) + ffmpeg.
# System deps mirror render/zo-deploy.sh setup(): that apt list is the proven
# reference set for chrome-headless-shell on a clean Debian box.
FROM node:22-bookworm-slim

RUN apt-get update -y && apt-get install -y --no-install-recommends \
    ffmpeg \
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
RUN npx remotion browser ensure

COPY --chown=node:node . .

EXPOSE 8080
CMD ["npm", "run", "server"]

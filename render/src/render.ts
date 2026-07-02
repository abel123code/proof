import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
/** render/ project root — the cwd the Remotion CLI runs in. */
export const RENDER_ROOT = resolve(here, "..");

/**
 * Invoke the Remotion CLI to render <Main>. Paths are RENDER_ROOT-relative with forward
 * slashes (no spaces in the repo path), which keeps the shell command portable Win/Linux.
 */
export function renderVideo(
  propsRelPath: string,
  outRelPath: string,
  extraArgs: string[] = [],
): Promise<void> {
  const cmd = [
    "npx remotion render remotion/index.ts Main",
    outRelPath,
    `--props=${propsRelPath}`,
    "--public-dir=remotion/public",
    "--log=info",
    ...extraArgs,
  ].join(" ");

  return new Promise((resolveP, reject) => {
    const p = spawn(cmd, { cwd: RENDER_ROOT, stdio: "inherit", shell: true, env: process.env });
    p.on("error", reject);
    p.on("close", (code) =>
      code === 0 ? resolveP() : reject(new Error(`remotion render exited with code ${code}`)),
    );
  });
}

/**
 * Render the TRANSPARENT caption/overlay layer to a ProRes 4444 .mov (alpha preserved).
 * No video component is mounted, so OffthreadVideo seeking can never fail.
 */
export function renderOverlay(propsRelPath: string, outRelPath: string): Promise<void> {
  // ProRes 4444 + PNG frames + explicit alpha pixel format = a real alpha channel.
  // (JPEG frames or the default pixel format silently drop alpha -> opaque black.)
  return renderVideo(propsRelPath, outRelPath, [
    "--codec=prores",
    "--prores-profile=4444",
    "--image-format=png",
    "--pixel-format=yuva444p10le",
  ]);
}

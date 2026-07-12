import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

// Resolve the installed `hyperframes` package so we can run its bundled CLI directly with
// node (no npx, no network). Throws MODULE_NOT_FOUND if the dep isn't installed — the premium
// orchestrator catches that and falls back to the fixed-component render.
const require = createRequire(import.meta.url);
function hyperframesCli(): string {
  const pkgJson = require.resolve("hyperframes/package.json");
  // package.json bin: { "hyperframes": "./dist/cli.js" }
  return join(dirname(pkgJson), "dist", "cli.js");
}

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function run(cmd: string, args: string[], timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      p.kill("SIGKILL");
      reject(new Error(`hyperframes timed out after ${timeoutMs}ms:\n${stderr.slice(-1200)}`));
    }, timeoutMs);
    p.stdout.on("data", (d) => (stdout += d.toString()));
    p.stderr.on("data", (d) => (stderr += d.toString()));
    p.on("error", (e) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(e);
    });
    p.on("close", (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

/**
 * Render a single authored composition to a TRANSPARENT MOV (ProRes 4444 w/ alpha), which
 * composites onto the base clip identically to the Remotion overlay.mov.
 *
 * HyperFrames renders a project DIRECTORY (its index.html), so we drop the authored HTML into
 * `sceneDir/index.html` and point the CLI at the dir. `--format mov` is the alpha path;
 * `--resolution portrait` = 1080x1920 (proof's short format).
 *
 * NOTE (verify on Railway): HyperFrames downloads its own Chromium via @puppeteer/browsers on
 * first render. The exact flags here were read from `hyperframes render --help` (v0.7.54).
 */
export async function renderComposition(opts: {
  html: string;
  sceneDir: string;
  outMovPath: string;
  fps?: number;
  timeoutMs?: number;
}): Promise<void> {
  const { html, sceneDir, outMovPath, fps = 30, timeoutMs = 240_000 } = opts;
  await mkdir(sceneDir, { recursive: true });
  await writeFile(join(sceneDir, "index.html"), html, "utf8");

  const cli = hyperframesCli();
  const res = await run(
    "node",
    [
      cli,
      "render",
      sceneDir,
      "--format", "mov", // MOV renders with transparency (alpha)
      "--fps", String(fps),
      "--resolution", "portrait", // 1080x1920
      "--output", outMovPath,
      "--quality", "high",
      "--quiet",
    ],
    timeoutMs,
  );
  if (res.code !== 0) {
    throw new Error(`hyperframes render exited ${res.code}:\n${res.stderr.slice(-1500)}`);
  }
}

/**
 * Lint a composition dir with `hyperframes check`. Non-throwing: returns the report so the
 * author loop can decide whether to retry. (Rendering itself also lints; this is a cheap
 * pre-flight before we pay for a full render.)
 */
export async function checkComposition(
  html: string,
  sceneDir: string,
): Promise<{ ok: boolean; report: string }> {
  await mkdir(sceneDir, { recursive: true });
  await writeFile(join(sceneDir, "index.html"), html, "utf8");
  try {
    const cli = hyperframesCli();
    const res = await run("node", [cli, "check", sceneDir], 60_000);
    return { ok: res.code === 0, report: `${res.stdout}\n${res.stderr}`.trim() };
  } catch (e) {
    return { ok: false, report: (e as Error).message };
  }
}

/** True if the hyperframes CLI is installed and resolvable (used to gate the premium path). */
export function hyperframesAvailable(): boolean {
  try {
    hyperframesCli();
    return true;
  } catch {
    return false;
  }
}

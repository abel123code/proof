/**
 * Trust-boundary validator for model-authored scene HTML.
 *
 * The scene author is an LLM whose prompt is influenced by brief/script fields (ultimately
 * user-controlled), and its output is written to disk and executed by the HyperFrames headless
 * browser. A prompt-injected brief could try to emit external <script>s, network calls, or
 * long-running JS. GSAP is served LOCALLY (./gsap.min.js) and assets are local (./assets/...),
 * so a compliant scene needs ZERO network — which lets us reject every external reference.
 *
 * Best-effort allowlist (defense in depth, not a full sandbox): pair it with network egress
 * disabled at render time for real isolation.
 */
export function validateComposition(html: string, assetHints: string[]): string[] {
  const violations: string[] = [];

  if (!/id\s*=\s*["']stage["']/i.test(html)) {
    violations.push("missing #stage root element");
  }

  // 1. Every referenced URL (src/href + css url(...)) must be local or a data: URI.
  const urls: string[] = [];
  for (const m of html.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/gi)) urls.push(m[1]);
  for (const m of html.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) urls.push(m[1]);

  for (const raw of urls) {
    const url = raw.trim();
    if (url === "" || url.startsWith("#") || url.startsWith("data:")) continue; // fragment / inline
    if (/^(?:https?:|ftp:|wss?:|ws:|file:|blob:)/i.test(url) || url.startsWith("//")) {
      violations.push(`external URL not allowed: ${url.slice(0, 80)}`);
      continue;
    }
    const rel = url.replace(/^\.\//, "").replace(/^\//, "");
    if (/^gsap\.min\.js$/i.test(rel)) continue; // the local GSAP we ship into the scene dir
    if (/^assets\//i.test(rel)) {
      const name = rel.slice("assets/".length);
      if (assetHints.length === 0 || assetHints.includes(name)) continue;
      violations.push(`reference to unknown asset: ${rel.slice(0, 80)}`);
      continue;
    }
    violations.push(`unexpected local reference: ${url.slice(0, 80)}`);
  }

  // 2. Executable JS (script bodies + inline on*= handlers) must not touch the network or eval.
  //    Scanning only executable regions avoids false positives on the word "fetch" in copy.
  const js: string[] = [];
  for (const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) js.push(m[1]);
  for (const m of html.matchAll(/\son\w+\s*=\s*["']([^"']*)["']/gi)) js.push(m[1]);
  const code = js.join("\n");
  if (/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|importScripts)\s*\(/.test(code)) {
    violations.push("script uses a network API (fetch/XMLHttpRequest/WebSocket/EventSource)");
  }
  if (/\bimport\s*\(/.test(code)) violations.push("script uses dynamic import()");
  if (/\beval\s*\(/.test(code) || /new\s+Function\s*\(/.test(code)) {
    violations.push("script uses eval / new Function()");
  }
  if (/navigator\s*\.\s*sendBeacon/.test(code)) violations.push("script uses navigator.sendBeacon");

  return violations;
}

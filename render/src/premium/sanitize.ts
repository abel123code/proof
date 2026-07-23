import { parse } from "node-html-parser";

/**
 * Trust-boundary validator for model-authored scene HTML.
 *
 * The scene author is an LLM whose prompt is influenced by brief/script fields (ultimately
 * user-controlled), and its output is written to disk and executed by the HyperFrames headless
 * browser. GSAP is served LOCALLY (./gsap.min.js) and assets are local (./assets/...), so a
 * compliant scene needs ZERO network — which lets us reject every external reference.
 *
 * This parses the HTML (regex HTML matching leaks: unquoted attrs, srcset, srcdoc, meta-refresh,
 * @import) and walks every URL-bearing attribute + CSS import. It is still BEST-EFFORT: adversarial
 * inline JS can build a request dynamically, which no static check catches. The real trust boundary
 * is denying network egress to the render process — do that in deployment; this raises the bar and
 * catches the obvious/static cases. Returns a list of violations (empty = ok).
 */

// URL-bearing attributes a browser will fetch/navigate.
const URL_ATTRS = [
  "src",
  "href",
  "poster",
  "data",
  "action",
  "formaction",
  "background",
  "xlink:href",
  "ping",
  "cite",
];

// Elements a scene never needs and that can load/execute external content.
const FORBIDDEN_TAGS = new Set([
  "iframe",
  "object",
  "embed",
  "frame",
  "frameset",
  "portal",
  "base",
  "link", // stylesheet/preload/import — assets are inlined or ./assets, never <link>
]);

function isExternal(url: string): boolean {
  const u = url.trim();
  return /^(?:https?:|ftp:|wss?:|ws:|file:|blob:|javascript:)/i.test(u) || u.startsWith("//");
}

export function validateComposition(html: string, assetHints: string[]): string[] {
  const violations: string[] = [];

  let root;
  try {
    root = parse(html, { comment: false });
  } catch {
    return ["HTML did not parse"];
  }

  if (!root.querySelector("#stage") && !/id\s*=\s*["']?stage\b/i.test(html)) {
    violations.push("missing #stage root element");
  }

  const checkUrl = (raw: string | undefined, where: string): void => {
    const url = (raw || "").trim();
    if (url === "" || url.startsWith("#")) return; // fragment / empty
    if (/^data:/i.test(url)) {
      // Inline MEDIA only. An executable data: URL (e.g. `data:text/javascript,…` in a <script src>)
      // runs in the render page; allow only image/font media, reject everything else.
      if (/^data:(?:image|font)\//i.test(url)) return;
      violations.push(`non-media data: URL not allowed (${where}): ${url.slice(0, 60)}`);
      return;
    }
    if (isExternal(url)) {
      violations.push(`external URL not allowed (${where}): ${url.slice(0, 80)}`);
      return;
    }
    const rel = url.replace(/^\.?\//, "");
    if (rel.includes("..")) {
      violations.push(`path traversal not allowed (${where}): ${url.slice(0, 80)}`);
      return;
    }
    if (/^gsap\.min\.js$/i.test(rel)) return; // the local GSAP we stage into the scene dir
    if (/^assets\//i.test(rel)) {
      const name = rel.slice("assets/".length);
      if (assetHints.length === 0 || assetHints.includes(name)) return;
      violations.push(`reference to unknown asset (${where}): ${rel.slice(0, 80)}`);
      return;
    }
    violations.push(`unexpected local reference (${where}): ${url.slice(0, 80)}`);
  };

  for (const el of root.querySelectorAll("*")) {
    const tag = (el.rawTagName || "").toLowerCase();
    if (FORBIDDEN_TAGS.has(tag)) violations.push(`forbidden <${tag}> element`);

    const attrs = el.attributes || {};
    if ("srcdoc" in attrs) violations.push("srcdoc not allowed");
    if (tag === "meta" && /refresh/i.test(el.getAttribute("http-equiv") || "")) {
      violations.push("meta refresh not allowed");
    }
    // A <script> may only load the locally-staged GSAP; any other src (external, data:, or another
    // local file) is rejected outright — belt-and-suspenders over checkUrl for the executable path.
    if (tag === "script") {
      const src = (el.getAttribute("src") || "").trim();
      if (src && !/^\.?\/?gsap\.min\.js$/i.test(src)) {
        violations.push(`<script src> other than ./gsap.min.js not allowed: ${src.slice(0, 60)}`);
      }
    }

    for (const a of URL_ATTRS) {
      const v = el.getAttribute(a);
      if (v) checkUrl(v, a);
    }
    // srcset: comma-separated "<url> <descriptor>" candidates.
    const srcset = el.getAttribute("srcset");
    if (srcset) {
      for (const part of srcset.split(",")) checkUrl(part.trim().split(/\s+/)[0], "srcset");
    }
    // inline style url()
    const style = el.getAttribute("style");
    if (style) {
      for (const m of style.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) checkUrl(m[1], "style url()");
    }
  }

  // <style> blocks: url() + @import.
  for (const st of root.querySelectorAll("style")) {
    const css = st.text || "";
    for (const m of css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) checkUrl(m[1], "css url()");
    for (const m of css.matchAll(/@import\s+(?:url\(\s*)?["']?([^"')\s;]+)/gi)) checkUrl(m[1], "css @import");
  }

  // Inline JS (script bodies + on*= handlers) must not touch the network or eval.
  const codeParts: string[] = [];
  for (const s of root.querySelectorAll("script")) codeParts.push(s.text || "");
  for (const el of root.querySelectorAll("*")) {
    const attrs = el.attributes || {};
    for (const k of Object.keys(attrs)) if (/^on/i.test(k)) codeParts.push(attrs[k]);
  }
  const code = codeParts.join("\n");
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

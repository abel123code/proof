import { parse } from "node-html-parser";
import { legibleText, type UiRecords } from "./ui-record.js";

/**
 * Reject interface text a scene made up.
 *
 * A scene holds two kinds of text. Its own editorial copy - a headline like "ONE CLEAN LIST." -
 * belongs to no screenshot and is the author's to write. A reconstruction of a real product UI must
 * say exactly what the screenshot said. The author marks the second kind by wrapping it in one
 * element carrying `data-ui-source="<staged filename>"`, and only text inside that element is
 * policed here.
 *
 * This runs before the vision QA because it is deterministic. Whether "10.018" belongs in a video
 * whose screenshot said "10.016" is a string comparison, not a judgement call, and a model asked to
 * review the frame will sometimes look straight at it and call it fine.
 */
export interface InventionResult {
  ok: boolean;
  /** Text nodes inside a reconstruction that the record does not back. */
  invented: string[];
  /** Set when a whole reconstruction is rejected, rather than individual strings. */
  reason?: string;
}

/** Match on meaning, not formatting: casing and whitespace are the author's to choose. */
const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

export function checkInvention(html: string, records: UiRecords): InventionResult {
  const root = parse(html);
  const containers = root.querySelectorAll("[data-ui-source]");
  // No reconstruction means nothing here is claiming to quote a screenshot.
  if (containers.length === 0) return { ok: true, invented: [] };

  const invented: string[] = [];
  for (const container of containers) {
    const file = container.getAttribute("data-ui-source") ?? "";
    const allowed = legibleText(records[file]).map(norm);
    if (allowed.length === 0) {
      // Claiming to rebuild an image we never read is worse than not rebuilding it: every string
      // inside would be unverifiable.
      return {
        ok: false,
        invented: [],
        reason: `data-ui-source="${file}" has no extracted text to rebuild from`,
      };
    }

    // Script and style hold code, not text a viewer reads.
    for (const el of container.querySelectorAll("script, style")) el.remove();

    for (const node of container.querySelectorAll("*")) {
      // Leaf elements only. A parent's text is its children concatenated, which would never match
      // a single recorded string and would report every ancestor as invented.
      if (node.childNodes.some((child) => child.nodeType === 1)) continue;

      const text = norm(node.text);
      if (!text) continue;
      // A row is often split across spans, so a fragment of a recorded string is legitimate.
      if (allowed.some((entry) => entry.includes(text))) continue;

      invented.push(node.text.replace(/\s+/g, " ").trim());
    }
  }
  return { ok: invented.length === 0, invented };
}

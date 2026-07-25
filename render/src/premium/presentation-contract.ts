import { parse } from "node-html-parser";
import type { SceneSpec } from "../types.js";

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLocaleUpperCase();
}

export function validatePresentationContract(html: string, spec: SceneSpec): string[] {
  const violations: string[] = [];
  const backgroundTreatment = spec.backgroundTreatment ?? "footage";

  if (spec.mode === "overlay" && backgroundTreatment !== "footage") {
    violations.push("overlay scenes must use visible footage");
  }

  let root;
  try {
    root = parse(html, { comment: false });
  } catch {
    return [...violations, "presentation contract HTML did not parse"];
  }

  const stage = root.querySelector("#stage");
  if (!stage) return [...violations, "presentation contract is missing #stage"];

  const purpose = stage.getAttribute("data-visual-purpose")?.trim();
  if (purpose !== spec.visualPurpose) {
    violations.push(`#stage must declare data-visual-purpose="${spec.visualPurpose}"`);
  }

  const plannedHeadline = spec.headline?.trim();
  const headline = stage.querySelector("[data-scene-headline]");
  if (spec.mode === "overlay" && !plannedHeadline) {
    violations.push("footage overlays require a planned headline");
  }
  if (plannedHeadline) {
    if (!headline) {
      violations.push(`missing required headline "${plannedHeadline}"`);
    } else if (normalizeText(headline.text) !== normalizeText(plannedHeadline)) {
      violations.push(`required headline must exactly match "${plannedHeadline}"`);
    }
  }

  if (spec.supportingVisual?.trim() && !stage.querySelector("[data-supporting-visual]")) {
    violations.push("planned supporting visual is missing data-supporting-visual markup");
  }

  return violations;
}

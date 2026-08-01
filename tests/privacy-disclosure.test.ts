import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Two separate beta users asked what Proof does with their code, unprompted. The answer is good
 * (README + file names + language stats, never file contents, nothing stored), so it has to be
 * readable BEFORE someone hands over their handle, not only on the marketing page.
 *
 * JSX wraps this sentence at different points in each file, so compare on collapsed whitespace.
 */
const flatten = (path: string) => readFileSync(path, "utf8").replace(/\s+/g, " ");

const SURFACES = [
  { name: "landing hero, no account needed", path: "src/app/page.tsx" },
  { name: "settings, where the handle is entered", path: "src/app/settings/page.tsx" },
  { name: "repo picker private-repos card", path: "src/components/studio/project-panel.tsx" },
];

describe("GitHub privacy disclosure", () => {
  it.each(SURFACES)("is stated on the $name", ({ path }) => {
    const source = flatten(path);
    expect(source).toContain("Proof reads your");
    expect(source).toContain("README");
    expect(source).toContain("file names and language stats");
    expect(source).toContain("never reads your source code");
  });

  it("says it at the connect step, not just after connecting", () => {
    const settings = flatten("src/app/settings/page.tsx");
    // The disclosure must sit ABOVE the handle input, or it is not a disclosure.
    expect(settings.indexOf("never reads your source code")).toBeLessThan(
      settings.indexOf('data-tour="github-connect"'),
    );
  });

  it("keeps the not-stored claim on the surfaces that promise it", () => {
    for (const path of ["src/app/page.tsx", "src/app/settings/page.tsx"]) {
      expect(flatten(path)).toContain("not stored");
    }
  });
});

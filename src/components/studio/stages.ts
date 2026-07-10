// The pipeline, defined once so the stepper nav and the per-stage "continue"
// CTAs stay in sync. `enabled: false` stages render as locked/coming-soon.
export type Stage = {
  n: string;
  href: string;
  label: string;
  blurb: string;
  enabled: boolean;
};

export const STAGES: Stage[] = [
  {
    n: "01",
    href: "/connect",
    label: "Connect GitHub",
    blurb: "Build a profile of what this person actually ships.",
    enabled: true,
  },
  {
    n: "02",
    href: "/research",
    label: "Research & Plan",
    blurb: "Find what's trending, mine winning patterns, and pick a virality-scored angle.",
    enabled: true,
  },
  {
    n: "03",
    href: "/brief",
    label: "Brief & Film",
    blurb: "A scene-by-scene brief, ready to film and send to the editor.",
    enabled: true,
  },
];

export function stageIndex(pathname: string): number {
  return STAGES.findIndex((s) => s.href === pathname);
}

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
    href: "/",
    label: "Connect GitHub",
    blurb: "Build a profile of what this person actually ships.",
    enabled: true,
  },
  {
    n: "02",
    href: "/trends",
    label: "Trends",
    blurb: "Research what's trending right now and pick a topic to ride.",
    enabled: true,
  },
  {
    n: "03",
    href: "/clips",
    label: "Clips",
    blurb: "See what's already winning on TikTok for that topic.",
    enabled: true,
  },
  {
    n: "04",
    href: "/brief",
    label: "Brief",
    blurb: "A scene-by-scene content brief, ready to film.",
    enabled: true,
  },
];

export function stageIndex(pathname: string): number {
  return STAGES.findIndex((s) => s.href === pathname);
}

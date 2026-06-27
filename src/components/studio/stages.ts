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
    label: "Connect repo",
    blurb: "Understand what the project is and what's interesting about it.",
    enabled: true,
  },
  {
    n: "02",
    href: "/pool",
    label: "Reference pool",
    blurb: "Reverse-engineer founder-story clips into reusable structures.",
    enabled: true,
  },
  {
    n: "03",
    href: "/brief",
    label: "Brief",
    blurb: "Blend your project with a reference structure into a brief.",
    enabled: true,
  },
  {
    n: "04",
    href: "/script",
    label: "Script",
    blurb: "Turn the brief into a shot-by-shot script.",
    enabled: false,
  },
];

export function stageIndex(pathname: string): number {
  return STAGES.findIndex((s) => s.href === pathname);
}

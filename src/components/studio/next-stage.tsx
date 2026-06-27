import Link from "next/link";
import { Button } from "@/components/ui/button";
import { STAGES } from "@/components/studio/stages";

// Renders the "what's next" transition at the bottom of a stage. The parent
// decides *when* to show it (e.g. only once a stage's work is done); this just
// renders the handoff to the following stage.
export function NextStage({ from }: { from: string }) {
  const idx = STAGES.findIndex((s) => s.href === from);
  const next = idx === -1 ? undefined : STAGES[idx + 1];
  if (!next) return null;

  return (
    <div className="mt-10 flex flex-col gap-3 rounded-lg border border-border bg-secondary/40 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          Up next · {next.n}
        </span>
        <p className="mt-1 font-display text-lg leading-snug tracking-tight">
          {next.label}
        </p>
        <p className="mt-0.5 max-w-md text-sm text-muted-foreground">{next.blurb}</p>
      </div>
      {next.enabled ? (
        <Button asChild className="shrink-0">
          <Link href={next.href}>Continue →</Link>
        </Button>
      ) : (
        <Button disabled variant="outline" className="shrink-0">
          Coming soon
        </Button>
      )}
    </div>
  );
}

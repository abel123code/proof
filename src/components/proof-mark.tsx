/**
 * The Proof brand mark, the "play P" (a P whose counter is a play triangle).
 * Identical to the favicon (src/app/icon.svg) so the in-app logo matches the tab/OG icon.
 * Self-contained tile (carries its own dark background), so it reads on any surface.
 * Size it with a Tailwind size utility, e.g. <ProofMark className="size-8" />.
 */
export function ProofMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      className={`block ${className ?? ""}`}
      role="img"
      aria-label="Proof"
    >
      <rect x="4" y="4" width="92" height="92" rx="24" fill="#141418" />
      <path d="M34 24h19a18 18 0 0 1 0 36H44v16H34V24Z" fill="#e0533d" />
      <path d="M47 35v14l12-7-12-7Z" fill="#141418" />
    </svg>
  );
}

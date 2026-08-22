import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Shared shell for /privacy and /terms.
 *
 * A reading column, not a product page: one measure, generous leading, and the same warm paper
 * and display face as the rest of the site so these do not read as a bolted-on legal afterthought.
 */
export function LegalPage({
  kicker,
  title,
  updated,
  children,
}: {
  kicker: string;
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/60">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-5 sm:px-8">
          <Link href="/" className="flex items-center gap-2.5 font-mono text-xs tracking-wide">
            <span className="size-2 rounded-[2px] bg-primary" />
            <span>Proof</span>
          </Link>
          <nav className="flex gap-5 font-mono text-xs text-muted-foreground">
            <Link href="/privacy" className="transition-colors hover:text-foreground">
              privacy
            </Link>
            <Link href="/terms" className="transition-colors hover:text-foreground">
              terms
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-14 sm:px-8 sm:py-20">
        <p className="font-mono text-[11px] text-primary">{kicker}</p>
        <h1 className="mt-3 font-display text-4xl leading-[1.1] tracking-tight sm:text-5xl">{title}</h1>
        <p className="mt-4 font-mono text-xs text-muted-foreground">Last updated {updated}</p>

        <div
          className="mt-12 space-y-10 text-[15px] leading-relaxed text-foreground/90
            [&_a]:underline [&_a]:decoration-primary/40 [&_a]:underline-offset-4 hover:[&_a]:decoration-primary
            [&_h2]:font-display [&_h2]:text-2xl [&_h2]:tracking-tight [&_h2]:text-foreground
            [&_li]:pl-1 [&_p+p]:mt-4
            [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5 [&_ul]:marker:text-primary/50"
        >
          {children}
        </div>
      </main>

      <footer className="border-t border-border/60">
        <div className="mx-auto flex max-w-3xl flex-col gap-3 px-5 py-8 font-mono text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <span>Questions? abhishek.vulla@gmail.com</span>
          <Link href="/" className="transition-colors hover:text-foreground">
            back to Proof
          </Link>
        </div>
      </footer>
    </div>
  );
}

/** One titled section. Keeps the pages declarative and the spacing identical between them. */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2>{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

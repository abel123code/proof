import { Skeleton } from "@/components/ui/skeleton";
import { ProofMark } from "@/components/proof-mark";

// Shared route-level loading skeleton for studio pages. Rendered instantly on
// navigation (via loading.tsx) so the user sees structure immediately instead
// of a blank shell while the page's client fetches resolve.
export function StudioLoading({ marker = "00" }: { marker?: string }) {
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-[1100px] items-center justify-between px-8 py-4">
          <div className="flex items-center gap-3">
            <ProofMark className="size-8" />
            <Skeleton className="h-3 w-14" />
          </div>
          <Skeleton className="h-6 w-64 rounded-md" />
          <Skeleton className="h-6 w-24 rounded-md" />
        </div>
      </header>

      <main className="flex-1">
        <div className="mx-auto w-full max-w-[720px] px-8 py-10">
          <div className="flex items-center gap-3">
            <span className="font-mono text-[11px] text-primary">{marker}</span>
            <Skeleton className="h-6 w-48" />
          </div>
          <Skeleton className="mt-4 h-4 w-full max-w-md" />
          <Skeleton className="mt-2 h-4 w-3/4 max-w-sm" />

          <div className="mt-8 space-y-3">
            <Skeleton className="h-14 w-full rounded-lg" />
            <Skeleton className="h-14 w-full rounded-lg" />
            <Skeleton className="h-14 w-full rounded-lg" />
          </div>
        </div>
      </main>
    </div>
  );
}

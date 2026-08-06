// Raw recorded clips (scene-*.webm/mp4) live in the public `footage` bucket only
// until a brief's render finishes: once the final MP4 exists in the renders bucket,
// the source takes are dead weight, and dead weight in a public bucket on a 1GB
// free-tier cap is a problem that compounds with every brief a student records.
//
// There is no scheduler in this repo (no cron, no sweeper, no TTL) and no marker
// column to add (DDL is unavailable), so this cannot be a background sweep with
// its own state. Instead the decision is derived every time from data the app
// already has: a brief only qualifies once its render is unambiguously done. That
// makes the drain naturally idempotent — removing storage objects that are already
// gone is a no-op, so this can safely be invoked repeatedly (e.g. right after a
// render completes) without needing to track what has already run.
//
// Unknown or unexpected renderStatus values are treated as "keep", not "delete".
// The failure modes are asymmetric: keeping footage we didn't need to keep just
// wastes storage, but deleting footage we shouldn't have deleted destroys a
// student's only recording of a take that cannot be regenerated. When the status
// is anything other than a confirmed success, default to the reversible mistake.
//
// This module is intentionally pure — decideFootageCleanup takes plain data and
// returns ids, drainFootage takes side-effecting callbacks as injected deps — so
// the policy (who qualifies, and remove-before-forget ordering) can be unit
// tested without a real Supabase client or database.

export interface CleanupCandidate {
  id: string;
  renderStatus: string | null;
  renderUrl: string | null;
  footageCount: number;
}

export interface FootageDrainDeps {
  remove: (briefId: string) => Promise<void>;
  forget: (briefId: string) => Promise<void>;
}

export interface FootageDrainResult {
  cleared: number;
  failed: string[];
}

export function decideFootageCleanup(rows: CleanupCandidate[]): string[] {
  return rows
    .filter(
      (row) =>
        row.renderStatus === "done" &&
        typeof row.renderUrl === "string" &&
        row.renderUrl.length > 0 &&
        row.footageCount > 0
    )
    .map((row) => row.id);
}

export async function drainFootage(
  briefIds: string[],
  deps: FootageDrainDeps
): Promise<FootageDrainResult> {
  let cleared = 0;
  const failed: string[] = [];

  for (const briefId of briefIds) {
    try {
      // Remove the storage object first, forget it second: if remove fails and
      // throws, we never reach forget, so the row survives and the next drain
      // pass will retry it. Doing it the other way around would forget a brief
      // whose object removal we're not sure succeeded, orphaning storage that
      // nothing points to anymore and that we'd have no way to find again.
      await deps.remove(briefId);
      await deps.forget(briefId);
      cleared += 1;
    } catch {
      failed.push(briefId);
    }
  }

  return { cleared, failed };
}

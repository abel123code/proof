import Link from "next/link";
import { redirect } from "next/navigation";
import { ProofMark } from "@/components/proof-mark";
import { PendingActions } from "@/components/pending-actions";
import { getAuthUser, isAuthConfigured } from "@/lib/auth";
import { ensureProfile } from "@/lib/db";
import { pendingCopy, resolvePendingStatus, resolveUserCap } from "@/lib/pending";

export const dynamic = "force-dynamic";

/**
 * The waitlist page, and the escape hatch from it.
 *
 * It used to be a static page that said "we'll email you the moment a spot opens up".
 * Two things were wrong with that. There is no email provider anywhere in this codebase,
 * so the promise could never be kept. And `ensureProfile` only ran in the OAuth callback,
 * so a user who signed in BEFORE being approved held a valid session with no profile row,
 * and the middleware bounced them back here forever, even after an admin approved them.
 * The only way out was to sign out and back in, and sign-out lived on /settings, behind
 * the very gate they were stuck at.
 *
 * So the page now re-runs `ensureProfile` on every load. That call is idempotent: it
 * returns early when a profile already exists, and otherwise creates one if the user is
 * allowlisted and the cap allows. Approval therefore takes effect on the next page load,
 * which is what lets the copy honestly say "come back and refresh".
 */
export default async function PendingPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const params = await searchParams;
  let status = resolvePendingStatus(params.status);

  if (isAuthConfigured()) {
    const user = await getAuthUser();
    if (!user) redirect("/login");

    // The whole point of this page now. A failure here must not strand anyone, so fall
    // through to the waitlist copy rather than throwing a 500 at a signed-in user.
    const result = await ensureProfile({
      userId: user.id,
      email: user.email,
      githubUsername: user.githubUsername,
    }).catch(() => null);

    if (result === "active") redirect("/connect");
    if (result === "full") status = "full";
  }

  const cap = resolveUserCap(process.env.USER_CAP);
  const copy = pendingCopy(status, cap);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <div className="w-full max-w-md">
        <ProofMark className="mx-auto block size-10" />
        <h1 className="mt-6 font-display text-3xl leading-tight tracking-tight">{copy.title}</h1>
        <p className="mt-3 text-sm text-muted-foreground">{copy.body}</p>

        <PendingActions />

        {/* h-11 for a 44px touch target: this page is reached on a phone as often as a
            laptop, and it was a 20px-tall tap target before. */}
        <Link
          href="/"
          className="mt-4 inline-flex h-11 items-center justify-center px-4 text-sm text-foreground underline underline-offset-4"
        >
          Back to home
        </Link>
      </div>
    </div>
  );
}

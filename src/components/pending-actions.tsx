"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * The two things a waitlisted user needs and previously had neither of.
 *
 * Sign-out lived only on /settings, which sits behind the approval gate, so somebody
 * stuck here could not switch accounts without clearing cookies. And re-check exists
 * because the page re-runs `ensureProfile` server-side on every load: once an admin
 * approves them, this button is genuinely all it takes.
 */
export function PendingActions() {
  const router = useRouter();
  const [checking, setChecking] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  const recheck = useCallback(() => {
    setChecking(true);
    // A server-side refresh re-runs the page's ensureProfile call, which redirects to
    // /connect the moment the profile exists. Reset the flag in case it does not yet.
    router.refresh();
    window.setTimeout(() => setChecking(false), 1500);
  }, [router]);

  const signOut = useCallback(async () => {
    setSigningOut(true);
    setSignOutError(null);
    const supabase = createSupabaseBrowserClient();
    try {
      // signOut RESOLVES with { error } for ordinary failures rather than throwing, so
      // the returned value has to be inspected. A bare try/catch reports success for a
      // sign-out that did nothing.
      const { error } = await supabase.auth.signOut();
      if (error) throw error;

      // Then confirm the session is really gone before showing the login page. Saying
      // "signed out" while the cookies are still valid is worse than an error: on a
      // shared machine the next person walks straight back into the account.
      //
      // getSession() also returns { error }, and a storage failure yields session: null
      // ALONGSIDE an error. Reading only `session` would take "I could not tell you" as
      // "definitely signed out", which is the exact confusion this check exists to stop.
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (data.session) throw new Error("session still present after signOut");
    } catch {
      setSignOutError("Could not sign you out. Check your connection and try again.");
      setSigningOut(false);
      return;
    }
    window.location.href = "/login";
  }, []);

  return (
    <div className="mt-8 flex flex-col items-center gap-3">
      <button
        type="button"
        onClick={recheck}
        disabled={checking}
        className="inline-flex h-11 min-w-[220px] items-center justify-center rounded-full bg-primary px-6 font-mono text-sm font-medium text-primary-foreground transition hover:brightness-105 disabled:opacity-60"
      >
        {checking ? "Checking…" : "Check again"}
      </button>
      <button
        type="button"
        onClick={signOut}
        disabled={signingOut}
        className="inline-flex h-11 items-center justify-center px-4 font-mono text-xs text-muted-foreground underline-offset-4 transition hover:text-foreground hover:underline disabled:opacity-60"
      >
        {signingOut ? "Signing out…" : "Sign out or use a different account"}
      </button>
      {signOutError && (
        <p role="alert" className="max-w-xs font-mono text-[11px] leading-relaxed text-destructive">
          {signOutError}
        </p>
      )}
    </div>
  );
}

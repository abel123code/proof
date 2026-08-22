"use client";

import { Suspense, useState } from "react";
import { ProofMark } from "@/components/proof-mark";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { openSignupEnabled } from "@/lib/signup";

function LoginInner() {
  const params = useSearchParams();
  const next = params.get("next") ?? "/connect";
  const fromDemo = params.get("source") === "demo";
  const [loading, setLoading] = useState(false);
  // Inlined at build time by Next, so this is a constant in the bundle rather than a
  // runtime lookup. Flipping it needs a redeploy, which the server side does not.
  const openSignup = openSignupEnabled(process.env.NEXT_PUBLIC_OPEN_SIGNUP);

  async function signIn() {
    setLoading(true);
    const supabase = createSupabaseBrowserClient();
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });
    if (error) setLoading(false);
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm text-center">
        <Link href="/" className="mx-auto flex w-fit transition hover:opacity-80">
          <ProofMark className="size-10" />
        </Link>
        <h1 className="mt-6 font-display text-3xl leading-tight tracking-tight">
          {fromDemo ? "Ready to make your own?" : "Sign in to Proof"}
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {/* Telling someone they need an invite while signup is open would talk them out
              of the thing they can already do, so both variants react to the flag. */}
          {fromDemo ? (
            <>
              Sign in to start a real Proof project. Your demo take stays on your device and
              will not be transferred.
              {openSignup ? "" : " Proof is invite-only while we're in early access."}
            </>
          ) : openSignup ? (
            <>Sign in with Google to start building. Free while we&apos;re in early access.</>
          ) : (
            <>
              Proof is invite-only while we&apos;re in early access. Sign in with the Google
              account (email) you were approved with.
            </>
          )}
        </p>
        <Button onClick={signIn} disabled={loading} className="mt-6 w-full">
          {loading ? "Redirecting…" : "Continue with Google"}
        </Button>
        <Link
          href="/"
          className="mt-6 inline-flex items-center gap-1.5 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <span aria-hidden>←</span> Back to home
        </Link>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  );
}

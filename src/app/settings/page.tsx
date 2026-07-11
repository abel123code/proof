"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StudioHeader } from "@/components/studio/studio-header";
import { Kicker, SectionMarker } from "@/components/studio/primitives";
import { HANDLE_KEY } from "@/components/studio/github-handle";
import { getProfileData, refreshProfile } from "@/components/studio/profile-store";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function SettingsPage() {
  const [handle, setHandle] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const data = await getProfileData();
        setEmail(data?.email ?? null);
        const stored =
          data?.githubUsername ||
          (typeof window !== "undefined" ? window.localStorage.getItem(HANDLE_KEY) : null);
        if (stored) {
          setSaved(stored);
          setHandle(stored);
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const save = useCallback(async () => {
    if (!handle.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ githubUsername: handle.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not save");
      setSaved(data.githubUsername);
      setHandle(data.githubUsername);
      // Dev fallback: persist locally too, since there's no server profile without auth.
      try {
        window.localStorage.setItem(HANDLE_KEY, data.githubUsername);
      } catch {
        // ignore
      }
      // Refresh the shared store so the header/connect reflect the new handle.
      void refreshProfile();
      toast.success(`Saved @${data.githubUsername}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }, [handle]);

  const signOut = useCallback(async () => {
    setSigningOut(true);
    try {
      const supabase = createSupabaseBrowserClient();
      await supabase.auth.signOut();
    } catch {
      // ignore - still send them to login
    }
    try {
      window.localStorage.removeItem(HANDLE_KEY);
    } catch {
      // ignore
    }
    window.location.href = "/login";
  }, []);

  return (
    <div className="flex flex-1 flex-col">
      <StudioHeader />
      <main className="flex-1">
        <div className="mx-auto w-full max-w-[640px] px-8 py-10">
          <SectionMarker n="00" title="Settings" />
          <p className="mt-3 max-w-md text-sm text-muted-foreground">
            Connect your GitHub. We use it to pull your repos so you can pick which one to
            base a video on. You can change this any time.
          </p>

          <div className="mt-8">
            <Kicker>GitHub handle</Kicker>
            <div className="mt-2 flex gap-2">
              <Input
                placeholder="your github username (e.g. torvalds)"
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && save()}
                className="font-mono text-sm"
                disabled={loading}
                maxLength={120}
                autoComplete="off"
                spellCheck={false}
              />
              <Button onClick={save} disabled={saving || loading || !handle.trim()}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
            {saved && (
              <p className="mt-3 text-sm text-muted-foreground">
                Connected as{" "}
                <a
                  href={`https://github.com/${saved}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-foreground underline underline-offset-2"
                >
                  @{saved}
                </a>
                .{" "}
                <Link
                  href="/connect"
                  className="text-primary underline underline-offset-2"
                >
                  Pick a repo →
                </Link>
              </p>
            )}
          </div>

          <div className="mt-10 border-t border-border pt-6">
            <Kicker>Account</Kicker>
            <div className="mt-2">
              <p className="text-xs text-muted-foreground">Signed in as</p>
              <p className="mt-1 font-mono text-sm text-foreground">
                {loading ? "…" : email ?? "—"}
              </p>
            </div>
            <div className="mt-4 flex items-center justify-between gap-4">
              <p className="text-sm text-muted-foreground">
                Sign out of Proof on this device.
              </p>
              <Button variant="outline" onClick={signOut} disabled={signingOut}>
                {signingOut ? "Signing out…" : "Sign out"}
              </Button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

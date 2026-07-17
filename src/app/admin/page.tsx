"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { StudioHeader } from "@/components/studio/studio-header";
import { Kicker, SectionMarker } from "@/components/studio/primitives";

interface Profile {
  userId: string;
  email: string | null;
  githubUsername: string | null;
  isAdmin: boolean;
  createdAt: string;
}
interface AllowedUser {
  id: string;
  email: string | null;
  githubUsername: string | null;
  note: string | null;
  createdAt: string;
}
interface AccessRequest {
  id: string;
  email: string | null;
  githubUsername: string | null;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
}
interface Wallet {
  total: number;
  used: number;
  remaining: number;
}
interface BugReportContext {
  url?: string;
  projectId?: string;
  briefId?: string;
  renderJobId?: string;
  renderStatus?: string;
  lastError?: string;
  userAgent?: string;
}
interface BugReport {
  id: string;
  email: string | null;
  message: string;
  context: BugReportContext | null;
  status: "open" | "closed";
  createdAt: string;
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

export default function AdminPage() {
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [allowed, setAllowed] = useState<AllowedUser[]>([]);
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [wallets, setWallets] = useState<Record<string, Wallet>>({});
  const [bugReports, setBugReports] = useState<BugReport[]>([]);
  const [newEmail, setNewEmail] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/users");
      if (res.status === 403 || res.status === 401) {
        setForbidden(true);
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load");
      setProfiles(data.profiles ?? []);
      setAllowed(data.allowed ?? []);
      setRequests(data.requests ?? []);
      setWallets(data.wallets ?? {});
      setBugReports(data.bugReports ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  const grantCreditsTo = useCallback(
    async (userId: string) => {
      const raw = window.prompt("How many credits to add?", "500");
      if (raw === null) return;
      const amount = Number(raw);
      if (!Number.isFinite(amount) || amount === 0) {
        toast.error("Enter a non-zero number.");
        return;
      }
      setBusy(userId);
      try {
        const res = await fetch("/api/admin/credits", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, amount }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Could not grant");
        toast.success(`Added ${amount} credits`);
        await load();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not grant");
      } finally {
        setBusy(null);
      }
    },
    [load],
  );

  useEffect(() => {
    load();
  }, [load]);

  const addEmail = useCallback(async () => {
    const email = newEmail.trim().toLowerCase();
    if (!email) return;
    setBusy("add");
    try {
      const res = await fetch("/api/admin/allow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not add");
      setNewEmail("");
      toast.success(`Allowlisted ${email}`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add");
    } finally {
      setBusy(null);
    }
  }, [newEmail, load]);

  const removeAllowed = useCallback(
    async (id: string) => {
      setBusy(id);
      try {
        const res = await fetch("/api/admin/allow", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Could not remove");
        await load();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not remove");
      } finally {
        setBusy(null);
      }
    },
    [load],
  );

  const actOnRequest = useCallback(
    async (id: string, action: "approve" | "reject") => {
      setBusy(id);
      try {
        const res = await fetch("/api/admin/requests", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, action }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Action failed");
        toast.success(action === "approve" ? "Approved" : "Rejected");
        await load();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Action failed");
      } finally {
        setBusy(null);
      }
    },
    [load],
  );

  const triageBug = useCallback(
    async (id: string, action: "close" | "reopen") => {
      setBusy(id);
      try {
        const res = await fetch("/api/admin/bug-reports", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, action }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Action failed");
        await load();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Action failed");
      } finally {
        setBusy(null);
      }
    },
    [load],
  );

  const pending = requests.filter((r) => r.status === "pending");
  const openBugs = bugReports.filter((b) => b.status === "open");

  // The context line is what makes a report actionable — which brief/render it came
  // from, and whether the render itself errored. Keep it terse; it's a scannable index.
  const bugMeta = (b: BugReport): string => {
    const c = b.context ?? {};
    const short = (v?: string) => (v && v.length > 8 ? `${v.slice(0, 8)}…` : v);
    return [
      b.email ?? "unknown",
      c.briefId ? `brief ${short(c.briefId)}` : null,
      c.renderJobId ? `render ${short(c.renderJobId)}` : null,
      c.renderStatus ? `status ${c.renderStatus}` : null,
      fmtDate(b.createdAt),
    ]
      .filter(Boolean)
      .join(" · ");
  };

  return (
    <div className="flex flex-1 flex-col">
      <StudioHeader />
      <main className="flex-1">
        <div className="mx-auto w-full max-w-[820px] px-4 py-10 sm:px-8">
          <SectionMarker n="99" title="Admin" />
          <p className="mt-3 max-w-md text-sm text-muted-foreground">
            Approve people who tried to sign in, manage the allowlist, and see who has
            access. Capped at 50 active users.
          </p>

          {loading ? (
            <div className="mt-8 space-y-3">
              <Skeleton className="h-24 w-full rounded-lg" />
              <Skeleton className="h-24 w-full rounded-lg" />
            </div>
          ) : forbidden ? (
            <div className="mt-8 rounded-md border border-dashed border-border p-6 text-sm text-muted-foreground">
              You don&apos;t have admin access. Ask an existing admin to flag your profile
              (<code className="font-mono">is_admin</code>).
            </div>
          ) : (
            <>
              {/* Pending requests */}
              <section className="mt-8">
                <Kicker>Pending requests ({pending.length})</Kicker>
                {pending.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    No one is waiting. People who sign in without an allowlisted email show
                    up here.
                  </p>
                ) : (
                  <div className="mt-2 divide-y divide-border rounded-lg border border-border">
                    {pending.map((r) => (
                      <div
                        key={r.id}
                        className="flex flex-wrap items-center gap-3 gap-y-2 px-4 py-3"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-mono text-sm">
                            {r.email ?? r.githubUsername ?? "unknown"}
                          </p>
                          <p className="font-mono text-[10px] text-muted-foreground/70">
                            requested {fmtDate(r.createdAt)}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          className="h-7 px-3 text-xs"
                          disabled={busy === r.id}
                          onClick={() => actOnRequest(r.id, "approve")}
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-3 text-xs"
                          disabled={busy === r.id}
                          onClick={() => actOnRequest(r.id, "reject")}
                        >
                          Reject
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Bug reports */}
              <section className="mt-8">
                <Kicker>Bug reports ({openBugs.length})</Kicker>
                {bugReports.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Nothing reported. Anything sent from the &ldquo;Report a bug&rdquo; button
                    shows up here, with the brief and render it came from.
                  </p>
                ) : (
                  <div className="mt-2 divide-y divide-border rounded-lg border border-border">
                    {bugReports.map((b) => (
                      <div
                        key={b.id}
                        className={`flex flex-wrap items-center gap-3 gap-y-2 px-4 py-3 ${
                          b.status === "closed" ? "opacity-60" : ""
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-mono text-sm" title={b.message}>
                            {b.message}
                          </p>
                          <p className="truncate font-mono text-[10px] text-muted-foreground/70">
                            {bugMeta(b)}
                          </p>
                          {b.context?.lastError && (
                            <p
                              className="truncate font-mono text-[10px] text-destructive/80"
                              title={b.context.lastError}
                            >
                              {b.context.lastError}
                            </p>
                          )}
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-3 text-xs"
                          disabled={busy === b.id}
                          onClick={() => triageBug(b.id, b.status === "open" ? "close" : "reopen")}
                        >
                          {b.status === "open" ? "Close" : "Reopen"}
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Allowlist */}
              <section className="mt-10">
                <Kicker>Allowlist ({allowed.length})</Kicker>
                <div className="mt-2 flex gap-2">
                  <Input
                    type="email"
                    placeholder="email to approve (e.g. someone@gmail.com)"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addEmail()}
                    className="font-mono text-sm"
                  />
                  <Button onClick={addEmail} disabled={busy === "add" || !newEmail.trim()}>
                    {busy === "add" ? "Adding…" : "Add"}
                  </Button>
                </div>
                {allowed.length > 0 && (
                  <div className="mt-3 divide-y divide-border rounded-lg border border-border">
                    {allowed.map((a) => (
                      <div key={a.id} className="flex items-center gap-3 px-4 py-2.5">
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-mono text-sm">
                            {a.email ?? a.githubUsername ?? "—"}
                          </p>
                          {a.note && (
                            <p className="font-mono text-[10px] text-muted-foreground/70">
                              {a.note}
                            </p>
                          )}
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
                          disabled={busy === a.id}
                          onClick={() => removeAllowed(a.id)}
                        >
                          Remove
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Active users */}
              <section className="mt-10">
                <Kicker>Active users ({profiles.length}/50)</Kicker>
                {profiles.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">No one has signed in yet.</p>
                ) : (
                  <div className="mt-2 divide-y divide-border rounded-lg border border-border">
                    {profiles.map((p) => (
                      <div key={p.userId} className="flex flex-wrap items-center gap-3 gap-y-2 px-4 py-2.5">
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-mono text-sm">
                            {p.email ?? "—"}
                            {p.githubUsername && (
                              <span className="text-muted-foreground">
                                {" "}
                                · @{p.githubUsername}
                              </span>
                            )}
                          </p>
                          <p className="font-mono text-[10px] text-muted-foreground/70">
                            joined {fmtDate(p.createdAt)}
                          </p>
                        </div>
                        <span
                          title="Credits remaining"
                          className="font-mono text-[11px] text-muted-foreground"
                        >
                          {wallets[p.userId]?.remaining ?? "—"} cr
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs"
                          disabled={busy === p.userId}
                          onClick={() => grantCreditsTo(p.userId)}
                        >
                          {busy === p.userId ? "…" : "+ Credits"}
                        </Button>
                        {p.isAdmin && (
                          <Badge className="bg-primary/15 font-mono text-[9px] uppercase text-primary">
                            admin
                          </Badge>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

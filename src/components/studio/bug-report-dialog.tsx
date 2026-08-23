"use client";

import { useCallback, useMemo, useState } from "react";
import { Dialog } from "radix-ui";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { describeReportContext, getReportContext } from "@/components/studio/report-context";

const MAX = 2000;

/**
 * "Report a bug" for the founding-user beta. Deliberately one field: the value is in
 * the context we attach automatically (which brief, which render job, the render
 * error), not in making the user describe their setup. The disclosure strip shows
 * exactly what gets sent, so the auto-capture is legible rather than sneaky.
 */
export function BugReportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  // Read the breadcrumbs when the dialog opens, not on every render.
  const chips = useMemo(() => {
    if (!open) return [];
    const url = typeof window === "undefined" ? undefined : window.location.href;
    return describeReportContext(getReportContext(), url);
  }, [open]);

  const submit = useCallback(async () => {
    const text = message.trim();
    if (!text) return;
    setSending(true);
    try {
      const res = await fetch("/api/bug-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          context: {
            ...getReportContext(),
            url: typeof window === "undefined" ? undefined : window.location.href,
            userAgent: typeof navigator === "undefined" ? undefined : navigator.userAgent,
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not send");
      toast.success("Thanks, we can see exactly what you were doing.");
      setMessage("");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send");
    } finally {
      setSending(false);
    }
  }, [message, onOpenChange]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-foreground/20 backdrop-blur-[2px] data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[61] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-6 shadow-2xl outline-none data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
          <p className="font-mono text-[10px] text-primary">
            Report a bug
          </p>
          <Dialog.Title className="mt-2 font-display text-2xl tracking-tight text-foreground">
            What went wrong?
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-sm leading-relaxed text-muted-foreground">
            We&apos;re in beta and reading every one of these. Rough notes are fine.
          </Dialog.Description>

          <Textarea
            autoFocus
            value={message}
            onChange={(e) => setMessage(e.target.value.slice(0, MAX))}
            placeholder="the render finished but the graphics were on my face"
            rows={4}
            className="mt-4"
          />

          {chips.length > 0 && (
            <div className="mt-3">
              <p className="font-mono text-[10px] text-muted-foreground/70">
                Attached automatically
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {chips.map((c) => (
                  <span
                    key={c}
                    className="rounded-full border border-border px-2 py-0.5 font-mono text-[10px] text-muted-foreground/70"
                  >
                    {c}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Dialog.Close asChild>
              <Button variant="outline" disabled={sending}>
                Cancel
              </Button>
            </Dialog.Close>
            <Button onClick={submit} disabled={sending || !message.trim()}>
              {sending ? "Sending…" : "Send report"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

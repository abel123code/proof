"use client";

import { AlertDialog } from "radix-ui";
import { Button } from "@/components/ui/button";
import { renderConfirmationDescription } from "@/lib/render-confirmation";

interface RenderConfirmDialogProps {
  open: boolean;
  cost: number | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export function RenderConfirmDialog({
  open,
  cost,
  onOpenChange,
  onConfirm,
}: RenderConfirmDialogProps) {
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-[60] bg-foreground/20 backdrop-blur-[2px] data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <AlertDialog.Content className="fixed left-1/2 top-1/2 z-[61] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-6 shadow-2xl outline-none data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">
                Final check
              </p>
              <AlertDialog.Title className="mt-2 font-display text-2xl tracking-tight text-foreground">
                Render this video?
              </AlertDialog.Title>
            </div>
            <div className="shrink-0 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 font-mono text-xs font-medium text-primary">
              {cost ?? "—"} credits
            </div>
          </div>

          <AlertDialog.Description className="mt-4 text-sm leading-relaxed text-muted-foreground">
            {renderConfirmationDescription(cost ?? 0)}
          </AlertDialog.Description>

          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialog.Cancel asChild>
              <Button variant="outline">Cancel</Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <Button onClick={onConfirm}>Render video</Button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

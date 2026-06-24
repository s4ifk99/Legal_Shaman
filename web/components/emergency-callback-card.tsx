"use client";

import { useState } from "react";
import { Lock, PhoneCall } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type EmergencyCallbackCardProps = {
  className?: string;
};

/** Coming soon: paid emergency callback ($10). */
export function EmergencyCallbackCard({ className }: EmergencyCallbackCardProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "group flex h-full min-h-[10.5rem] w-full gap-4 rounded-2xl border-2 border-destructive/35 bg-destructive/5 p-5 text-left shadow-sm transition-all duration-200",
          "hover:-translate-y-0.5 hover:border-destructive/60 hover:bg-destructive/10 hover:shadow-md active:translate-y-0 active:scale-[0.99]",
          className,
        )}
      >
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-destructive/30 bg-card/80">
          <PhoneCall className="h-5 w-5 text-destructive" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-serif text-lg font-semibold text-foreground group-hover:text-destructive">
              Get an instant call back
            </h3>
            <span className="rounded-full bg-gold/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gold-foreground">
              Coming soon
            </span>
          </div>
          <p className="mt-2 text-xs font-medium text-destructive/90">
            Not for life-threatening emergencies — call 999.
          </p>
        </div>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif text-xl">Instant emergency callback</DialogTitle>
            <DialogDescription>
              This feature is coming soon. When live, you&apos;ll be able to request an urgent callback for
              time-sensitive legal matters.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 rounded-lg border border-gold/30 bg-muted/40 p-4 text-sm">
            <p className="flex items-center gap-2 font-medium text-foreground">
              <Lock className="h-4 w-4 text-gold" />
              $10.00 per callback request
            </p>
            <p className="text-muted-foreground">
              Payment unlocks a priority callback queue for urgent (non-999) legal situations — court deadlines,
              bail, eviction notices, and similar.
            </p>
            <p className="text-xs text-muted-foreground">
              Legal Shaman does not provide legal advice. Callbacks connect you with independent providers.
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Close
            </Button>
            <Button type="button" disabled className="gap-2">
              <Lock className="h-4 w-4" />
              Pay $10.00 — coming soon
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

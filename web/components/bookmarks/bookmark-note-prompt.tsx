"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { captureProductEvent } from "@/components/analytics/posthog-provider";
import { FUNNEL_EVENTS } from "@/lib/analytics/funnel-events";
import type { BookmarkInput, BookmarkStatus } from "@/lib/bookmarks/types";
import { useBookmarks } from "@/components/bookmarks/bookmarks-provider";

type BookmarkNotePromptProps = {
  bookmark: BookmarkInput;
  open: boolean;
  onClose: () => void;
};

export function BookmarkNotePrompt({ bookmark, open, onClose }: BookmarkNotePromptProps) {
  const { updateBookmarkNotes } = useBookmarks();
  const [note, setNote] = useState("");
  const [nextAction, setNextAction] = useState("");
  const [status, setStatus] = useState<BookmarkStatus>("not_contacted");
  const [saving, setSaving] = useState(false);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div
        role="dialog"
        aria-labelledby="note-prompt-title"
        className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-lg"
      >
        <h2 id="note-prompt-title" className="font-serif text-lg font-semibold text-foreground">
          Next step for {bookmark.businessName}?
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Add a private note or follow-up so you can return to this shortlist later.
        </p>
        <label className="mt-4 block text-xs font-medium text-foreground">
          Note
          <textarea
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Who you spoke to, fees quoted, eligibility…"
          />
        </label>
        <label className="mt-3 block text-xs font-medium text-foreground">
          Follow-up action
          <input
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            value={nextAction}
            onChange={(e) => setNextAction(e.target.value)}
            placeholder="e.g. Call Monday morning"
          />
        </label>
        <label className="mt-3 block text-xs font-medium text-foreground">
          Status
          <select
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            value={status}
            onChange={(e) => setStatus(e.target.value as BookmarkStatus)}
          >
            <option value="not_contacted">Not contacted</option>
            <option value="contacted">Contacted</option>
            <option value="awaiting_response">Awaiting response</option>
            <option value="follow_up_required">Follow-up required</option>
            <option value="not_suitable">Not suitable</option>
            <option value="engaged">Engaged</option>
          </select>
        </label>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Skip
          </Button>
          <Button
            type="button"
            disabled={saving}
            onClick={() => {
              setSaving(true);
              void updateBookmarkNotes({
                entityId: bookmark.entityId,
                resultSource: bookmark.resultSource,
                note: note || null,
                nextAction: nextAction || null,
                status,
              }).then((ok) => {
                setSaving(false);
                if (ok) {
                  captureProductEvent(FUNNEL_EVENTS.noteSaved, {
                    entity_id: bookmark.entityId,
                    has_note: Boolean(note),
                    has_action: Boolean(nextAction),
                    status,
                  });
                }
                onClose();
              });
            }}
          >
            {saving ? "Saving…" : "Save note"}
          </Button>
        </div>
      </div>
    </div>
  );
}

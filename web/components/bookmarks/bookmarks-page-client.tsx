"use client";

import { LogOut } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { ExpandableDirectoryList } from "@/components/search/expandable-directory-list";
import { useBookmarks } from "@/components/bookmarks/bookmarks-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { BookmarkRecord, BookmarkStatus } from "@/lib/bookmarks/types";

function sourceLabel(source: BookmarkRecord["resultSource"]): string {
  switch (source) {
    case "sra":
      return "SRA";
    case "legal_aid":
      return "Legal aid";
    case "lawyer":
      return "Lawyer";
    case "firm":
      return "Firm";
    default:
      return "Listing";
  }
}

function statusLabel(status: BookmarkStatus): string {
  return status.replace(/_/g, " ");
}

export function BookmarksPageClient() {
  const { user, bookmarks, loading, signOut, updateBookmarkNotes } = useBookmarks();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftNote, setDraftNote] = useState("");
  const [draftAction, setDraftAction] = useState("");
  const [draftStatus, setDraftStatus] = useState<BookmarkStatus>("not_contacted");

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  if (!user) {
    return (
      <Card className="border-primary/20">
        <CardContent className="py-12 text-center">
          <h2 className="font-serif text-xl font-semibold text-foreground">Your bookmarks</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            Sign in or create a free account with your name and email to save firms, private notes,
            and follow-up actions.
          </p>
          <Button className="mt-6" asChild>
            <Link href="/login">Create account or sign in</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Signed in as <span className="font-medium text-foreground">{user.name}</span> ({user.email})
        </p>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void signOut()}>
          <LogOut className="h-4 w-4" />
          Sign out
        </Button>
      </div>

      {bookmarks.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No bookmarks yet. Search for a firm and click{" "}
            <span className="font-medium text-foreground">Bookmark</span> to save it here.{" "}
            <Link href="/ask-the-shaman" className="text-primary underline">
              Search directory
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Click a saved firm for contact details. Notes and follow-ups stay private to your account.
          </p>
          <ul className="space-y-3">
            {bookmarks.map((b) => (
              <li key={b.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="font-semibold text-foreground">{b.businessName}</h3>
                    <p className="text-xs text-muted-foreground">
                      {sourceLabel(b.resultSource)} · {statusLabel(b.status)} · saved{" "}
                      {new Date(b.createdAt).toLocaleDateString("en-GB")}
                    </p>
                    {b.note ? (
                      <p className="mt-2 text-sm text-foreground">{b.note}</p>
                    ) : (
                      <p className="mt-2 text-sm text-muted-foreground">No note yet</p>
                    )}
                    {b.nextAction ? (
                      <p className="mt-1 text-sm text-primary">Next: {b.nextAction}</p>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setEditingId(b.id);
                      setDraftNote(b.note || "");
                      setDraftAction(b.nextAction || "");
                      setDraftStatus(b.status);
                    }}
                  >
                    Edit note
                  </Button>
                </div>
                {editingId === b.id ? (
                  <div className="mt-3 space-y-2 border-t border-border pt-3">
                    <textarea
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                      rows={3}
                      value={draftNote}
                      onChange={(e) => setDraftNote(e.target.value)}
                    />
                    <input
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                      value={draftAction}
                      onChange={(e) => setDraftAction(e.target.value)}
                      placeholder="Follow-up action"
                    />
                    <select
                      className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                      value={draftStatus}
                      onChange={(e) => setDraftStatus(e.target.value as BookmarkStatus)}
                    >
                      <option value="not_contacted">Not contacted</option>
                      <option value="contacted">Contacted</option>
                      <option value="awaiting_response">Awaiting response</option>
                      <option value="follow_up_required">Follow-up required</option>
                      <option value="not_suitable">Not suitable</option>
                      <option value="engaged">Engaged</option>
                    </select>
                    <div className="flex gap-2">
                      <Button type="button" variant="ghost" size="sm" onClick={() => setEditingId(null)}>
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => {
                          void updateBookmarkNotes({
                            entityId: b.entityId,
                            resultSource: b.resultSource,
                            note: draftNote || null,
                            nextAction: draftAction || null,
                            status: draftStatus,
                          }).then(() => setEditingId(null));
                        }}
                      >
                        Save
                      </Button>
                    </div>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          <ExpandableDirectoryList
            query=""
            items={bookmarks.map((b) => ({
              entityId: b.entityId,
              resultSource: b.resultSource,
              businessName: b.businessName,
              subtitle: `${sourceLabel(b.resultSource)} · ${statusLabel(b.status)}`,
            }))}
          />
        </div>
      )}
    </div>
  );
}

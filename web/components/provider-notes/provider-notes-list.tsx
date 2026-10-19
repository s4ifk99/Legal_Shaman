"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { useBookmarks } from "@/components/bookmarks/bookmarks-provider";
import {
  PROVIDER_NOTE_STATUS_LABEL,
  type ProviderNoteRecord,
} from "@/lib/provider-notes/types";

export function ProviderNotesList() {
  const { user, loading } = useBookmarks();
  const [notes, setNotes] = useState<ProviderNoteRecord[] | null>(null);

  useEffect(() => {
    if (!user) {
      setNotes(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const res = await fetch("/api/provider-notes");
      if (!res.ok) return;
      const data = (await res.json()) as { notes: ProviderNoteRecord[] };
      if (!cancelled) setNotes(data.notes);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (loading || !user) return null;

  return (
    <section className="space-y-3">
      <h2 className="font-serif text-xl font-semibold text-foreground">Provider notes</h2>
      <p className="text-sm text-muted-foreground">
        Private notes and contact statuses from your research. They stay on this account.
      </p>
      {!notes ? (
        <p className="text-sm text-muted-foreground">Loading notes…</p>
      ) : notes.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-sm text-muted-foreground">
            No provider notes yet. Open a results workspace and save a note beside an organisation.
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-3">
          {notes.map((note) => (
            <li key={note.id}>
              <Card>
                <CardContent className="space-y-1 py-4">
                  <p className="font-medium text-foreground">{note.displayName}</p>
                  <p className="text-sm text-muted-foreground">
                    {PROVIDER_NOTE_STATUS_LABEL[note.status]}
                    {note.shortlisted ? " · Shortlisted" : ""}
                    {note.contactedOn ? ` · Contacted ${note.contactedOn}` : ""}
                  </p>
                  {note.contactName ? (
                    <p className="text-sm text-muted-foreground">Spoke to {note.contactName}</p>
                  ) : null}
                  {note.whatTheySaid ? <p className="text-sm">{note.whatTheySaid}</p> : null}
                  {note.url ? (
                    <a className="text-sm text-primary underline" href={note.url} target="_blank" rel="noreferrer">
                      Website
                    </a>
                  ) : null}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

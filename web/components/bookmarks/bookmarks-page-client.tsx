"use client";

import { LogOut } from "lucide-react";
import Link from "next/link";

import { ExpandableDirectoryList } from "@/components/search/expandable-directory-list";
import { useBookmarks } from "@/components/bookmarks/bookmarks-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { BookmarkRecord } from "@/lib/bookmarks/types";

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

export function BookmarksPageClient() {
  const { user, bookmarks, loading, signOut } = useBookmarks();

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  if (!user) {
    return (
      <Card className="border-primary/20">
        <CardContent className="py-12 text-center">
          <h2 className="font-serif text-xl font-semibold text-foreground">Your bookmarks</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            Sign in or create a free account with your name and email to save firms and view your
            shortlist here.
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
            Click a saved firm for full contact details.
          </p>
          <ExpandableDirectoryList
            query=""
            items={bookmarks.map((b) => ({
              entityId: b.entityId,
              resultSource: b.resultSource,
              businessName: b.businessName,
              subtitle: `${sourceLabel(b.resultSource)} · saved ${new Date(b.createdAt).toLocaleDateString("en-GB")}`,
            }))}
          />
        </div>
      )}
    </div>
  );
}

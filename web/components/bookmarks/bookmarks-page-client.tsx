"use client";

import Link from "next/link";
import { Bookmark, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useBookmarks } from "@/components/bookmarks/bookmarks-provider";
import { searchUrlForListingName } from "@/lib/search/result-navigation";
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
  const { user, bookmarks, loading, setAuthOpen, signOut } = useBookmarks();

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  if (!user) {
    return (
      <Card className="border-primary/20">
        <CardContent className="py-12 text-center">
          <Bookmark className="mx-auto mb-4 h-10 w-10 text-primary" />
          <h2 className="font-serif text-xl font-semibold text-foreground">Your bookmarks</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            Sign in or create a free account with your name and email to save firms and view your
            shortlist here.
          </p>
          <Button className="mt-6" onClick={() => setAuthOpen(true)}>
            Create account or sign in
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
            <Link href="/search" className="text-primary underline">
              Search directory
            </Link>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-3">
          {bookmarks.map((b) => (
            <li key={b.id}>
              <Card>
                <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-semibold text-foreground">{b.businessName}</h2>
                      <Badge variant="outline">{sourceLabel(b.resultSource)}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Saved {new Date(b.createdAt).toLocaleDateString("en-GB")}
                    </p>
                  </div>
                  <Link
                    href={searchUrlForListingName(b.businessName)}
                    className="text-sm font-medium text-primary hover:underline"
                  >
                    View in search
                  </Link>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

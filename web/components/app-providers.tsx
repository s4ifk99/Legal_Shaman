"use client";

import { BookmarksProvider } from "@/components/bookmarks/bookmarks-provider";
import { CanonicalHostRedirect } from "@/components/site/canonical-host-redirect";

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <BookmarksProvider>
      <CanonicalHostRedirect />
      {children}
    </BookmarksProvider>
  );
}

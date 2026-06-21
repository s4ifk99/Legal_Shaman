"use client";

import { BookmarksProvider } from "@/components/bookmarks/bookmarks-provider";

export function AppProviders({ children }: { children: React.ReactNode }) {
  return <BookmarksProvider>{children}</BookmarksProvider>;
}

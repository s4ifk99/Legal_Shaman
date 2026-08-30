"use client";

import { BookmarksProvider } from "@/components/bookmarks/bookmarks-provider";
import { CanonicalHostRedirect } from "@/components/site/canonical-host-redirect";
import { PostHogProvider } from "@/components/analytics/posthog-provider";

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <BookmarksProvider>
      <PostHogProvider>
        <CanonicalHostRedirect />
        {children}
      </PostHogProvider>
    </BookmarksProvider>
  );
}

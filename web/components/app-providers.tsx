"use client";

import { Suspense, type ReactNode } from "react";
import { BookmarksProvider } from "@/components/bookmarks/bookmarks-provider";
import { CanonicalHostRedirect } from "@/components/site/canonical-host-redirect";
import {
  PostHogPageView,
  PostHogProvider,
} from "@/components/analytics/posthog-provider";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <BookmarksProvider>
      <PostHogProvider>
        <CanonicalHostRedirect />
        <Suspense fallback={null}>
          <PostHogPageView />
        </Suspense>
        {children}
      </PostHogProvider>
    </BookmarksProvider>
  );
}

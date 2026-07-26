"use client";

import { useBookmarks } from "@/components/bookmarks/bookmarks-provider";
import type { AuthDialogReason } from "@/components/bookmarks/auth-dialog";
import { requireSearchAuthEnabled } from "@/lib/auth/search-auth-config";

export function useRequireAuth() {
  const { user, requireAuth, openAuthForSearch, loading } = useBookmarks();
  const searchAuthOn = requireSearchAuthEnabled();
  return {
    user,
    loading,
    requireAuth: (action: () => void, reason: AuthDialogReason = "search") => {
      if (!searchAuthOn && reason === "search") {
        action();
        return;
      }
      requireAuth(action, reason);
    },
    openAuthForSearch: (retry?: () => void) => {
      if (!searchAuthOn) {
        retry?.();
        return;
      }
      openAuthForSearch(retry);
    },
    isAuthenticated: Boolean(user),
    searchAuthRequired: searchAuthOn,
  };
}

"use client";

import { useBookmarks } from "@/components/bookmarks/bookmarks-provider";
import type { AuthDialogReason } from "@/components/bookmarks/auth-dialog";

export function useRequireAuth() {
  const { user, requireAuth, openAuthForSearch, loading } = useBookmarks();
  return {
    user,
    loading,
    requireAuth: (action: () => void, reason: AuthDialogReason = "search") =>
      requireAuth(action, reason),
    openAuthForSearch,
    isAuthenticated: Boolean(user),
  };
}

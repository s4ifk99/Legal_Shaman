"use client";

import { useBookmarks } from "@/components/bookmarks/bookmarks-provider";
import type { AuthDialogReason } from "@/components/bookmarks/auth-dialog";
import { requireCoherenceAuthEnabled } from "@/lib/auth/coherence-auth-config";

export function useCoherenceAuth() {
  const { user, requireAuth, loading } = useBookmarks();
  const authRequired = requireCoherenceAuthEnabled();

  return {
    user,
    loading,
    authRequired,
    emailVerified: user?.emailVerified !== false,
    isAuthenticated: Boolean(user),
    requireCoherenceAuth: (action: () => void) => {
      if (!authRequired) {
        action();
        return;
      }
      requireAuth(action, "coherence");
    },
  };
}

export type { AuthDialogReason };

"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { PublicUser } from "@/lib/auth/user-session";
import type { BookmarkInput, BookmarkKey, BookmarkRecord } from "@/lib/bookmarks/types";
import { bookmarkKeyString } from "@/lib/bookmarks/types";
import { AuthDialog, type AuthDialogReason } from "@/components/bookmarks/auth-dialog";
import { resolveApiUrl } from "@/lib/site/api-url";

type BookmarksContextValue = {
  user: PublicUser | null;
  bookmarks: BookmarkRecord[];
  loading: boolean;
  authOpen: boolean;
  authReason: AuthDialogReason;
  setAuthOpen: (open: boolean) => void;
  openAuth: (reason?: AuthDialogReason) => void;
  requireAuth: (action: () => void, reason?: AuthDialogReason) => void;
  openAuthForSearch: (retry?: () => void) => void;
  isBookmarked: (key: BookmarkKey) => boolean;
  toggleBookmark: (input: BookmarkInput) => Promise<boolean>;
  refreshBookmarks: () => Promise<void>;
  signOut: () => Promise<void>;
};

const BookmarksContext = createContext<BookmarksContextValue | null>(null);

export function useBookmarks(): BookmarksContextValue {
  const ctx = useContext(BookmarksContext);
  if (!ctx) {
    throw new Error("useBookmarks must be used within BookmarksProvider");
  }
  return ctx;
}

export function BookmarksProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [bookmarks, setBookmarks] = useState<BookmarkRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [authOpen, setAuthOpen] = useState(false);
  const [authReason, setAuthReason] = useState<AuthDialogReason>("bookmark");
  const [pendingBookmark, setPendingBookmark] = useState<BookmarkInput | null>(null);
  const pendingSearchActionRef = useRef<(() => void) | null>(null);

  const refreshBookmarks = useCallback(async () => {
    const res = await fetch(resolveApiUrl("/api/bookmarks"));
    if (res.status === 401) {
      setBookmarks([]);
      return;
    }
    if (!res.ok) return;
    const data = (await res.json()) as { bookmarks: BookmarkRecord[] };
    setBookmarks(data.bookmarks);
  }, []);

  const loadSession = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(resolveApiUrl("/api/auth/session"));
      if (!res.ok) {
        setUser(null);
        setBookmarks([]);
        return;
      }
      const data = (await res.json()) as { user: PublicUser | null };
      setUser(data.user);
      if (data.user) {
        await refreshBookmarks();
      } else {
        setBookmarks([]);
      }
    } finally {
      setLoading(false);
    }
  }, [refreshBookmarks]);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  const addBookmark = useCallback(async (input: BookmarkInput): Promise<boolean> => {
    const res = await fetch(resolveApiUrl("/api/bookmarks"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { bookmark: BookmarkRecord };
    setBookmarks((prev) => {
      const key = bookmarkKeyString(input);
      const filtered = prev.filter((b) => bookmarkKeyString(b) !== key);
      return [data.bookmark, ...filtered];
    });
    return true;
  }, []);

  const removeBookmark = useCallback(async (key: BookmarkKey): Promise<boolean> => {
    const res = await fetch(resolveApiUrl("/api/bookmarks"), {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(key),
    });
    if (!res.ok) return false;
    setBookmarks((prev) => prev.filter((b) => bookmarkKeyString(b) !== bookmarkKeyString(key)));
    return true;
  }, []);

  const isBookmarked = useCallback(
    (key: BookmarkKey) => bookmarks.some((b) => bookmarkKeyString(b) === bookmarkKeyString(key)),
    [bookmarks],
  );

  const openAuth = useCallback((reason: AuthDialogReason = "login") => {
    setAuthReason(reason);
    setAuthOpen(true);
  }, []);

  const requireAuth = useCallback(
    (action: () => void, reason: AuthDialogReason = "search") => {
      if (user) {
        action();
        return;
      }
      pendingSearchActionRef.current = action;
      openAuth(reason);
    },
    [user, openAuth],
  );

  const openAuthForSearch = useCallback(
    (retry?: () => void) => {
      if (retry) pendingSearchActionRef.current = retry;
      openAuth("search");
    },
    [openAuth],
  );

  const toggleBookmark = useCallback(
    async (input: BookmarkInput): Promise<boolean> => {
      if (!user) {
        setPendingBookmark(input);
        openAuth("bookmark");
        return false;
      }

      const key = bookmarkKeyString(input);
      if (isBookmarked(input)) {
        return removeBookmark(input);
      }
      return addBookmark(input);
    },
    [user, isBookmarked, removeBookmark, addBookmark, openAuth],
  );

  const handleAuthSuccess = useCallback(
    async (nextUser: PublicUser) => {
      setUser(nextUser);
      setAuthOpen(false);
      if (pendingBookmark) {
        await addBookmark(pendingBookmark);
        setPendingBookmark(null);
      } else {
        await refreshBookmarks();
      }
      const pendingSearch = pendingSearchActionRef.current;
      pendingSearchActionRef.current = null;
      if (pendingSearch) pendingSearch();
    },
    [pendingBookmark, addBookmark, refreshBookmarks],
  );

  const signOut = useCallback(async () => {
    await fetch(resolveApiUrl("/api/auth/logout"), { method: "POST" });
    setUser(null);
    setBookmarks([]);
    setPendingBookmark(null);
    pendingSearchActionRef.current = null;
  }, []);

  const value = useMemo(
    () => ({
      user,
      bookmarks,
      loading,
      authOpen,
      authReason,
      setAuthOpen,
      openAuth,
      requireAuth,
      openAuthForSearch,
      isBookmarked,
      toggleBookmark,
      refreshBookmarks,
      signOut,
    }),
    [
      user,
      bookmarks,
      loading,
      authOpen,
      authReason,
      openAuth,
      requireAuth,
      openAuthForSearch,
      isBookmarked,
      toggleBookmark,
      refreshBookmarks,
      signOut,
    ],
  );

  return (
    <BookmarksContext.Provider value={value}>
      {children}
      <AuthDialog
        open={authOpen}
        onOpenChange={(open) => {
          setAuthOpen(open);
          if (!open) {
            setPendingBookmark(null);
            pendingSearchActionRef.current = null;
          }
        }}
        onSuccess={handleAuthSuccess}
        reason={authReason}
        pendingFirmName={pendingBookmark?.businessName}
      />
    </BookmarksContext.Provider>
  );
}

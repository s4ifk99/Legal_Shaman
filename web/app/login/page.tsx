"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Footer } from "@/components/footer";
import { Header } from "@/components/header";
import { useBookmarks } from "@/components/bookmarks/bookmarks-provider";

/**
 * Dedicated /login route so Sign in always has a page destination.
 * Opens the shared auth dialog on the Sign in tab; signed-in users go to bookmarks.
 */
export default function LoginPage() {
  const router = useRouter();
  const { user, loading, openAuth } = useBookmarks();

  useEffect(() => {
    if (loading) return;
    if (user) {
      router.replace("/bookmarks");
      return;
    }
    openAuth("login");
  }, [loading, user, openAuth, router]);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center px-4 py-16 text-center">
        <h1 className="font-serif text-3xl font-bold text-foreground">Sign in</h1>
        <p className="mt-3 text-muted-foreground">
          Sign in with your email and password to access bookmarks and search results.
        </p>
        {!user ? (
          <button
            type="button"
            onClick={() => openAuth("login")}
            className="bg-primary text-primary-foreground hover:bg-primary/90 mt-8 inline-flex h-10 items-center justify-center rounded-md px-6 text-sm font-medium"
          >
            Open sign in
          </button>
        ) : null}
      </main>
      <Footer />
    </div>
  );
}

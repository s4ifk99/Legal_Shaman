"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useBookmarks } from "@/components/bookmarks/bookmarks-provider";
import { LegalShamanLogo } from "@/components/legal-shaman-logo";
import { cn } from "@/lib/utils";

export function SimpleHeader() {
  const { user, openAuth, signOut } = useBookmarks();
  const pathname = usePathname();
  const onCase = pathname === "/my-case" || pathname.startsWith("/my-case/");

  return (
    <header className="relative z-20 border-b border-white/25 bg-transparent backdrop-blur-[1px]">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
        <Link href="/" className="flex items-center" aria-label="Legal Shaman home">
          <LegalShamanLogo className="h-auto w-[min(18rem,50vw)]" priority />
        </Link>
        <div className="flex items-center gap-2">
          <Link
            href="/ask-the-shaman"
            className={cn(
              "inline-flex h-9 items-center rounded-xl border px-3 text-sm font-medium transition",
              pathname.startsWith("/ask-the-shaman") && !pathname.includes("/wiki")
                ? "border-primary bg-primary text-primary-foreground"
                : "border-white/40 bg-background/35 text-foreground/80 hover:border-primary/40 hover:text-foreground",
            )}
          >
            Ask the Shaman
          </Link>
          <Link
            href="/blog"
            className={cn(
              "hidden h-9 items-center rounded-xl border px-3 text-sm font-medium transition sm:inline-flex",
              pathname.startsWith("/blog")
                ? "border-primary bg-primary text-primary-foreground"
                : "border-white/40 bg-background/35 text-foreground/80 hover:border-primary/40 hover:text-foreground",
            )}
          >
            Blog
          </Link>
          <Link
            href="/my-case"
            className={cn(
              "inline-flex h-9 items-center rounded-xl border px-3 text-sm font-medium transition",
              onCase
                ? "border-primary bg-primary text-primary-foreground"
                : "border-white/40 bg-background/35 text-foreground/80 hover:border-primary/40 hover:text-foreground",
            )}
          >
            Your case
          </Link>
          {!user ? (
            <button
              type="button"
              onClick={() => openAuth("case")}
              className="inline-flex h-9 items-center rounded-xl bg-primary px-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
            >
              Account
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void signOut()}
              className="inline-flex h-9 items-center rounded-xl border border-white/40 bg-background/35 px-3 text-sm font-medium text-foreground/80 hover:border-primary/40 hover:text-foreground"
            >
              Log out
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

"use client";

import { MapPin, ChevronDown, Menu, X, Bookmark } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SpiralDecoration } from "./spiral-decoration";
import { useBookmarks } from "@/components/bookmarks/bookmarks-provider";
import { cn } from "@/lib/utils";

const navBoxBase =
  "inline-flex h-8 items-center justify-center gap-1 rounded-lg border px-2.5 text-xs font-medium shadow-sm transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 active:scale-[0.98]";

const navBoxVariants = {
  default:
    "border-border/70 bg-card/90 text-muted-foreground hover:border-primary/30 hover:bg-muted/60 hover:text-foreground",
  primary:
    "border-primary/50 bg-primary text-primary-foreground hover:border-primary hover:bg-primary/90 hover:shadow-primary/25",
} as const;

type NavBoxVariant = keyof typeof navBoxVariants;

function NavBoxLink({
  href,
  variant = "default",
  className,
  children,
  onClick,
  active,
}: {
  href: string;
  variant?: NavBoxVariant;
  className?: string;
  children: ReactNode;
  onClick?: () => void;
  active?: boolean;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={cn(
        navBoxBase,
        active ? navBoxVariants.primary : navBoxVariants[variant],
        className,
      )}
    >
      {children}
    </Link>
  );
}

function NavBoxButton({
  variant = "default",
  className,
  children,
  onClick,
}: {
  variant?: NavBoxVariant;
  className?: string;
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(navBoxBase, navBoxVariants[variant], className)}
    >
      {children}
    </button>
  );
}

const locations = [
  "All United Kingdom",
  "London",
  "Birmingham",
  "Manchester",
  "Leeds",
  "Glasgow",
  "Liverpool",
  "Bristol",
  "Sheffield",
  "Edinburgh",
  "Cardiff",
];

export function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { user, openAuth, signOut } = useBookmarks();
  const pathname = usePathname();
  const onShaman =
    pathname === "/ask-the-shaman" || pathname.startsWith("/ask-the-shaman/");
  const onSignpost = pathname === "/signposting" || pathname.startsWith("/signposting");

  return (
    <header className="relative overflow-hidden border-b-2 border-gold/30 bg-card">
      <div className="absolute -right-20 -top-20 opacity-10">
        <SpiralDecoration size={200} color="var(--teal)" />
      </div>
      <div className="absolute -left-16 -bottom-16 opacity-10">
        <SpiralDecoration size={150} color="var(--coral)" />
      </div>

      <div className="relative mx-auto max-w-6xl px-4 py-4">
        <div className="flex items-center justify-between">
          <Link href="/" className="flex items-center group" aria-label="Legal Shaman home">
            <div className="relative">
              <Image
                src="/legal-shaman-header-transparent.png"
                alt="Legal Shaman"
                width={1024}
                height={114}
                className="relative h-auto w-[min(30rem,55vw)] max-w-full"
              />
            </div>
          </Link>

          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={cn(navBoxBase, navBoxVariants.default, "gap-2 px-3")}
                >
                  <MapPin className="h-4 w-4 shrink-0 text-primary" />
                  <span className="hidden sm:inline">UK</span>
                  <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="border-gold/30">
                {locations.map((location) => (
                  <DropdownMenuItem key={location} className="hover:bg-accent/20">
                    {location}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <nav className="hidden items-center gap-1.5 md:flex">
              <NavBoxLink href="/ask-the-shaman" active={onShaman}>
                Ask the Shaman
              </NavBoxLink>
              <NavBoxLink href="/signposting" active={onSignpost}>
                Signpost
              </NavBoxLink>
              <NavBoxLink href="/bookmarks">
                <Bookmark className="h-4 w-4" />
                Bookmarks
              </NavBoxLink>
              {!user ? (
                <NavBoxButton variant="primary" onClick={() => openAuth("login")}>
                  Login
                </NavBoxButton>
              ) : (
                <NavBoxButton onClick={() => void signOut()}>Log out</NavBoxButton>
              )}
            </nav>

            <button
              type="button"
              aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
              className={cn(navBoxBase, navBoxVariants.default, "px-2.5 md:hidden")}
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {mobileMenuOpen ? (
          <nav className="mt-4 grid gap-2 border-t border-border/70 pt-4 md:hidden">
            <NavBoxLink
              href="/ask-the-shaman"
              active={onShaman}
              className="w-full"
              onClick={() => setMobileMenuOpen(false)}
            >
              Ask the Shaman
            </NavBoxLink>
            <NavBoxLink
              href="/signposting"
              active={onSignpost}
              className="w-full"
              onClick={() => setMobileMenuOpen(false)}
            >
              Signpost
            </NavBoxLink>
            <NavBoxLink
              href="/bookmarks"
              className="w-full"
              onClick={() => setMobileMenuOpen(false)}
            >
              <Bookmark className="h-4 w-4" />
              Bookmarks
            </NavBoxLink>
            {!user ? (
              <NavBoxButton
                variant="primary"
                className="w-full"
                onClick={() => {
                  setMobileMenuOpen(false);
                  openAuth("login");
                }}
              >
                Login
              </NavBoxButton>
            ) : (
              <NavBoxButton
                className="w-full"
                onClick={() => {
                  setMobileMenuOpen(false);
                  void signOut();
                }}
              >
                Log out
              </NavBoxButton>
            )}
          </nav>
        ) : null}
      </div>
    </header>
  );
}

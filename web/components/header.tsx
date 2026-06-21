"use client";

import { MapPin, ChevronDown, Menu, X, Bookmark } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
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
  "inline-flex items-center justify-center gap-1.5 rounded-xl border px-3.5 py-2 text-sm font-medium shadow-sm transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 active:scale-[0.98]";

const navBoxVariants = {
  default:
    "border-border/70 bg-card/90 text-muted-foreground hover:border-primary/30 hover:bg-muted/60 hover:text-foreground",
  primary:
    "border-primary/50 bg-primary text-primary-foreground hover:border-primary hover:bg-primary/90 hover:shadow-primary/25",
  accent:
    "border-secondary/40 bg-card/90 text-secondary hover:border-secondary/70 hover:bg-secondary/10 hover:text-secondary",
} as const;

type NavBoxVariant = keyof typeof navBoxVariants;

function NavBoxLink({
  href,
  variant = "default",
  className,
  children,
  onClick,
}: {
  href: string;
  variant?: NavBoxVariant;
  className?: string;
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={cn(navBoxBase, navBoxVariants[variant], className)}
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
  const { user, setAuthOpen } = useBookmarks();

  return (
    <header className="relative overflow-hidden border-b-2 border-gold/30 bg-card">
      {/* Subtle spiral decoration */}
      <div className="absolute -right-20 -top-20 opacity-10">
        <SpiralDecoration size={200} color="var(--teal)" />
      </div>
      <div className="absolute -left-16 -bottom-16 opacity-10">
        <SpiralDecoration size={150} color="var(--coral)" />
      </div>
      
      <div className="relative mx-auto max-w-6xl px-4 py-4">
        <div className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3 group">
            <div className="relative">
              <div className="absolute -inset-1 rounded-full bg-gradient-to-br from-primary/30 to-secondary/30 opacity-0 blur transition-opacity group-hover:opacity-100" />
              <Image
                src="/logo.jpg"
                alt="Legal Shaman Logo"
                width={52}
                height={52}
                className="relative h-13 w-13 rounded-full border-2 border-gold/50"
              />
            </div>
            <div className="flex flex-col">
              <span className="font-serif text-xl font-bold tracking-tight md:text-2xl">
                <span className="text-primary">Legal</span>{" "}
                <span className="text-secondary">Shaman</span>
              </span>
              <span className="hidden text-xs text-muted-foreground md:block">Navigate Your Disputes</span>
            </div>
          </Link>

          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={cn(navBoxBase, navBoxVariants.default, "gap-2 px-3 py-2")}
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

            {/* Desktop nav */}
            <nav className="hidden items-center gap-1.5 lg:flex">
              <NavBoxLink href="/find-a-lawyer" variant="primary">
                Find a Lawyer
              </NavBoxLink>
              <NavBoxLink href="/search">Search</NavBoxLink>
              <NavBoxLink href="/ask-the-shaman">Ask the Shaman</NavBoxLink>
              <NavBoxLink href="/oslaw">OSLAW</NavBoxLink>
              <NavBoxLink href="/bookmarks">
                <Bookmark className="h-4 w-4" />
                Bookmarks
              </NavBoxLink>
              {!user ? (
                <NavBoxButton onClick={() => setAuthOpen(true)}>Sign in</NavBoxButton>
              ) : null}
              <NavBoxLink href="/signposting">Signposting</NavBoxLink>
              <NavBoxLink href="/submit" variant="accent">
                List Business
              </NavBoxLink>
            </nav>

            {/* Mobile menu button */}
            <button
              type="button"
              aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
              className={cn(navBoxBase, navBoxVariants.default, "px-2.5 py-2 md:hidden")}
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        {mobileMenuOpen && (
          <nav className="mt-4 grid grid-cols-2 gap-2 border-t border-border/70 pt-4 md:hidden">
            <NavBoxLink
              href="/find-a-lawyer"
              variant="primary"
              className="col-span-2 w-full"
              onClick={() => setMobileMenuOpen(false)}
            >
              Find a Lawyer
            </NavBoxLink>
            <NavBoxLink href="/search" className="w-full" onClick={() => setMobileMenuOpen(false)}>
              Search
            </NavBoxLink>
            <NavBoxLink href="/ask-the-shaman" className="w-full" onClick={() => setMobileMenuOpen(false)}>
              Ask the Shaman
            </NavBoxLink>
            <NavBoxLink href="/oslaw" className="w-full" onClick={() => setMobileMenuOpen(false)}>
              OSLAW
            </NavBoxLink>
            <NavBoxLink href="/bookmarks" className="w-full" onClick={() => setMobileMenuOpen(false)}>
              <Bookmark className="h-4 w-4" />
              Bookmarks
            </NavBoxLink>
            {!user ? (
              <NavBoxButton
                className="w-full"
                onClick={() => {
                  setAuthOpen(true);
                  setMobileMenuOpen(false);
                }}
              >
                Sign in
              </NavBoxButton>
            ) : null}
            <NavBoxLink href="/signposting" className="w-full" onClick={() => setMobileMenuOpen(false)}>
              Signposting
            </NavBoxLink>
            <NavBoxLink
              href="/submit"
              variant="accent"
              className="col-span-2 w-full"
              onClick={() => setMobileMenuOpen(false)}
            >
              List Business
            </NavBoxLink>
          </nav>
        )}
      </div>
    </header>
  );
}

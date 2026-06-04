"use client";

import { MapPin, ChevronDown, Menu, X } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SpiralDecoration } from "./spiral-decoration";

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

          <div className="flex items-center gap-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2 border-primary/30 bg-transparent hover:bg-primary/10">
                  <MapPin className="h-4 w-4 text-primary" />
                  <span className="hidden sm:inline">UK</span>
                  <ChevronDown className="h-3 w-3" />
                </Button>
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
            <nav className="hidden items-center gap-1 md:flex">
              <Link
                href="/find-a-lawyer"
                className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-all hover:scale-105 hover:shadow-lg"
              >
                Find a Lawyer
              </Link>
              <Link
                href="/search"
                className="rounded-full px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                Search
              </Link>
              <Link
                href="/#categories"
                className="rounded-full px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                Categories
              </Link>
              <Link
                href="/submit"
                className="rounded-full border border-secondary/50 px-4 py-2 text-sm text-secondary transition-colors hover:bg-secondary hover:text-secondary-foreground"
              >
                List Business
              </Link>
            </nav>

            {/* Mobile menu button */}
            <Button
              variant="ghost"
              size="sm"
              className="md:hidden"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
          </div>
        </div>

        {/* Mobile menu */}
        {mobileMenuOpen && (
          <nav className="mt-4 flex flex-col gap-2 border-t border-border pt-4 md:hidden">
            <Link
              href="/find-a-lawyer"
              className="rounded-lg bg-primary px-4 py-3 text-center font-medium text-primary-foreground"
              onClick={() => setMobileMenuOpen(false)}
            >
              Find a Lawyer
            </Link>
            <Link
              href="/search"
              className="rounded-lg px-4 py-3 text-center text-muted-foreground hover:bg-muted"
              onClick={() => setMobileMenuOpen(false)}
            >
              Search
            </Link>
            <Link
              href="/#categories"
              className="rounded-lg px-4 py-3 text-center text-muted-foreground hover:bg-muted"
              onClick={() => setMobileMenuOpen(false)}
            >
              Categories
            </Link>
            <Link
              href="/submit"
              className="rounded-lg border border-secondary/50 px-4 py-3 text-center text-secondary"
              onClick={() => setMobileMenuOpen(false)}
            >
              List Your Business
            </Link>
          </nav>
        )}
      </div>
    </header>
  );
}

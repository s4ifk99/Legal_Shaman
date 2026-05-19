"use client";

import { MapPin, ChevronDown } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
  return (
    <header className="border-b-2 border-primary/20 bg-card">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <div className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <span className="font-serif text-2xl font-semibold tracking-tight text-primary md:text-3xl">
              Legal Shaman
            </span>
          </Link>

          <div className="flex items-center gap-4">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2 bg-transparent">
                  <MapPin className="h-4 w-4" />
                  <span className="hidden sm:inline">All United Kingdom</span>
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {locations.map((location) => (
                  <DropdownMenuItem key={location}>{location}</DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <nav className="hidden items-center gap-4 text-sm md:flex">
              <Link
                href="/find-a-lawyer"
                className="font-medium text-primary transition-colors hover:underline"
              >
                Find a Lawyer
              </Link>
              <Link
                href="/search"
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                Search
              </Link>
              <Link
                href="/#signposting"
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                Signposting
              </Link>
              <Link
                href="/submit"
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                List Your Business
              </Link>
            </nav>
          </div>
        </div>
      </div>
    </header>
  );
}

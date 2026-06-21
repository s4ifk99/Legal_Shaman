"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { signpostCategories, type SignpostCategory } from "@/lib/signpost/signpost-categories";
import { SignpostCategoryCard } from "./signpost-category-card";

type SignpostWidgetProps = {
  variant?: "embed" | "page";
};

function filterCategories(categories: SignpostCategory[], query: string): SignpostCategory[] {
  const q = query.trim().toLowerCase();
  if (!q) return categories;

  return categories
    .map((category) => {
      const titleMatch = category.title.toLowerCase().includes(q);
      const descriptionMatch = category.description.toLowerCase().includes(q);
      const matchingLinks = category.links.filter(
        (link) =>
          link.label.toLowerCase().includes(q) ||
          link.url.toLowerCase().includes(q) ||
          link.note?.toLowerCase().includes(q),
      );

      if (titleMatch || descriptionMatch) {
        return {
          ...category,
          links: matchingLinks.length > 0 ? matchingLinks : category.links,
        };
      }

      if (matchingLinks.length > 0) {
        return { ...category, links: matchingLinks };
      }

      return null;
    })
    .filter((category): category is SignpostCategory => category !== null);
}

export function SignpostWidget({ variant = "page" }: SignpostWidgetProps) {
  const isEmbed = variant === "embed";
  const [query, setQuery] = useState("");
  const filteredCategories = useMemo(
    () => filterCategories(signpostCategories, query),
    [query],
  );
  const isSearching = query.trim().length > 0;

  return (
    <div className={isEmbed ? "bg-background p-2 sm:p-3" : "w-full"}>
      <div
        className={`mx-auto flex flex-col overflow-hidden rounded-xl border-2 border-gold/30 bg-card shadow-lg ${
          isEmbed ? "max-w-3xl" : "max-w-4xl"
        }`}
      >
        <header className="border-b border-gold/20 px-4 py-4 text-center md:px-5">
          <h1 className="font-serif text-xl font-bold text-foreground md:text-2xl">
            Legal Shaman Signpost
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">Useful contacts to start your search</p>
        </header>

        <div className="border-b border-gold/20 px-4 py-3 md:px-5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search categories or resources…"
              className="h-10 border-gold/30 bg-background pl-9"
              aria-label="Search Signpost categories"
            />
          </div>
          {isSearching ? (
            <p className="mt-2 text-xs text-muted-foreground">
              {filteredCategories.length} categor{filteredCategories.length === 1 ? "y" : "ies"} matched
            </p>
          ) : null}
        </div>

        <div
          className={`space-y-2 overflow-y-auto px-3 py-3 md:px-4 ${
            isEmbed ? "max-h-[520px]" : "max-h-[640px]"
          }`}
        >
          {filteredCategories.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              No categories matched your search.
            </p>
          ) : (
            filteredCategories.map((category) => (
              <SignpostCategoryCard
                key={category.slug}
                category={category}
                forceOpen={isSearching}
              />
            ))
          )}
        </div>

        <footer className="border-t border-gold/20 px-4 py-3 text-center text-sm text-muted-foreground">
          <a
            href="https://www.legalshaman.com"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-primary hover:underline"
          >
            Powered by Legal Shaman
          </a>
        </footer>
      </div>

      {!isEmbed ? (
        <p className="mx-auto mt-4 max-w-4xl text-center text-sm text-muted-foreground">
          Embed this widget on your site via the{" "}
          <Link href="/embed/install" className="text-primary hover:underline">
            install page
          </Link>
          .
        </p>
      ) : null}
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

type ShamanSearchProps = {
  compact?: boolean;
};

export function ShamanSearch({ compact = false }: ShamanSearchProps) {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");
  const [filters, setFilters] = useState({
    legalAid: false,
    oslaw: false,
  });

  const handleFilterChange = (filterKey: keyof typeof filters) => {
    setFilters((prev) => ({
      ...prev,
      [filterKey]: !prev[filterKey],
    }));
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = searchQuery.trim();
    if (trimmed.length < 2) return;

    const params = new URLSearchParams();
    params.set("q", trimmed);
    if (filters.legalAid) {
      params.set("legalAid", "1");
    }
    if (filters.oslaw) {
      params.set("reddit", "1");
    }

    router.push(`/search?${params.toString()}`);
  };

  return (
    <div className={`w-full ${compact ? "space-y-4" : "space-y-6"}`}>
      {!compact ? (
        <div className="text-center">
          <h2 className="font-serif text-2xl font-bold text-foreground md:text-3xl">Try Shaman Search</h2>
          <p className="mt-2 text-muted-foreground">
            Search legal resources, filter by type, and find exactly what you need.
          </p>
        </div>
      ) : null}

      <div className={`rounded-2xl border-2 border-gold/30 bg-card ${compact ? "p-4" : "p-8"}`}>
        <form onSubmit={handleSearch} className="space-y-4">
          <div className="relative">
            <div className="absolute inset-y-0 left-0 flex items-center pl-4">
              <Search className="h-5 w-5 text-muted-foreground" />
            </div>
            <input
              type="text"
              placeholder="Search for legal help, advice, or resources..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-lg border-2 border-gold/30 bg-card py-3 pl-12 pr-4 text-foreground placeholder-muted-foreground focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/20"
            />
          </div>

          <div className="flex flex-wrap gap-6">
            <label className="flex cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={filters.legalAid}
                onChange={() => handleFilterChange("legalAid")}
                className="h-5 w-5 cursor-pointer rounded border-2 border-gold/40 bg-card text-gold focus:ring-2 focus:ring-gold/20"
              />
              <span className="font-medium text-foreground">Legal Aid</span>
            </label>
            <label className="flex cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={filters.oslaw}
                onChange={() => handleFilterChange("oslaw")}
                className="h-5 w-5 cursor-pointer rounded border-2 border-gold/40 bg-card text-gold focus:ring-2 focus:ring-gold/20"
              />
              <span className="font-medium text-foreground">
                OSLAW — see what the internet is saying
              </span>
            </label>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              type="submit"
              className="w-full rounded-lg bg-gold px-6 py-3 font-semibold text-gold-foreground transition-all hover:bg-gold/90 focus:outline-none focus:ring-2 focus:ring-gold/50 sm:flex-1"
            >
              Search
            </button>
            <button
              type="button"
              onClick={() => router.push("/oslaw")}
              className="w-full rounded-lg border-2 border-gold/40 px-6 py-3 font-semibold text-foreground transition-all hover:bg-gold/10 focus:outline-none focus:ring-2 focus:ring-gold/20 sm:flex-1"
            >
              Browse trending topics
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

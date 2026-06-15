'use client';

import { useState } from 'react';
import { Search } from 'lucide-react';

export function ShamanSearch() {
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState({
    legalAid: false,
    oslr: false,
  });

  const handleFilterChange = (filterKey: keyof typeof filters) => {
    setFilters((prev) => ({
      ...prev,
      [filterKey]: !prev[filterKey],
    }));
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    // Handle search submission
    console.log('[v0] Search:', { query: searchQuery, filters });
  };

  return (
    <div className="w-full">
      <form onSubmit={handleSearch} className="space-y-4">
        {/* Search Bar */}
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

        {/* Checkboxes */}
        <div className="flex flex-wrap gap-6">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={filters.legalAid}
              onChange={() => handleFilterChange('legalAid')}
              className="h-5 w-5 rounded border-2 border-gold/40 bg-card text-gold focus:ring-2 focus:ring-gold/20 cursor-pointer"
            />
            <span className="text-foreground font-medium">Legal Aid</span>
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={filters.oslr}
              onChange={() => handleFilterChange('oslr')}
              className="h-5 w-5 rounded border-2 border-gold/40 bg-card text-gold focus:ring-2 focus:ring-gold/20 cursor-pointer"
            />
            <span className="text-foreground font-medium">OSLR (Open Source Legal Research)</span>
          </label>
        </div>

        {/* Search Button */}
        <button
          type="submit"
          className="w-full rounded-lg bg-gold px-6 py-3 font-semibold text-gold-foreground transition-all hover:bg-gold/90 focus:outline-none focus:ring-2 focus:ring-gold/50"
        >
          Search
        </button>
      </form>
    </div>
  );
}

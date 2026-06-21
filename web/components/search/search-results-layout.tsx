"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { List, Map, Columns2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MapMarker } from "@/lib/search/map-results";

const LegalMap = dynamic(
  () => import("@/components/search/legal-map").then((m) => m.LegalMap),
  { ssr: false, loading: () => <div className="h-[420px] animate-pulse rounded-lg bg-muted" /> },
);

type ViewMode = "list" | "map" | "split";

type SearchResultsLayoutProps = {
  markers: MapMarker[];
  missingCoordinatesCount: number;
  children: React.ReactNode;
};

export function SearchResultsLayout({
  markers,
  missingCoordinatesCount,
  children,
}: SearchResultsLayoutProps) {
  const [view, setView] = useState<ViewMode>(markers.length ? "split" : "list");
  const showMap = markers.length > 0;

  return (
    <div className="space-y-3">
      {showMap ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant={view === "list" ? "default" : "outline"}
            onClick={() => setView("list")}
          >
            <List className="mr-1 h-4 w-4" />
            List
          </Button>
          <Button
            type="button"
            size="sm"
            variant={view === "map" ? "default" : "outline"}
            onClick={() => setView("map")}
          >
            <Map className="mr-1 h-4 w-4" />
            Map
          </Button>
          <Button
            type="button"
            size="sm"
            variant={view === "split" ? "default" : "outline"}
            onClick={() => setView("split")}
          >
            <Columns2 className="mr-1 h-4 w-4" />
            Split
          </Button>
          {missingCoordinatesCount > 0 ? (
            <span className="text-xs text-muted-foreground">
              {missingCoordinatesCount} result{missingCoordinatesCount === 1 ? "" : "s"} without map coordinates
            </span>
          ) : null}
        </div>
      ) : null}

      {view === "list" || !showMap ? (
        children
      ) : view === "map" ? (
        <LegalMap markers={markers} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="min-w-0">{children}</div>
          <LegalMap markers={markers} />
        </div>
      )}
    </div>
  );
}

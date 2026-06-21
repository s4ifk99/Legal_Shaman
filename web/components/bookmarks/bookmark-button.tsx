"use client";

import { Bookmark } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BookmarkInput } from "@/lib/bookmarks/types";
import { useBookmarks } from "@/components/bookmarks/bookmarks-provider";
import { cn } from "@/lib/utils";

type BookmarkButtonProps = {
  bookmark: BookmarkInput;
  className?: string;
  size?: "sm" | "default";
  showLabel?: boolean;
};

export function BookmarkButton({
  bookmark,
  className,
  size = "sm",
  showLabel = true,
}: BookmarkButtonProps) {
  const { isBookmarked, toggleBookmark, loading } = useBookmarks();
  const saved = isBookmarked(bookmark);

  return (
    <Button
      type="button"
      variant={saved ? "secondary" : "outline"}
      size={size}
      className={cn("gap-1.5", className)}
      disabled={loading}
      aria-pressed={saved}
      aria-label={saved ? "Remove bookmark" : "Bookmark this firm"}
      onClick={(e) => {
        e.stopPropagation();
        void toggleBookmark(bookmark);
      }}
    >
      <Bookmark className={cn("h-4 w-4", saved && "fill-current")} />
      {showLabel ? (saved ? "Bookmarked" : "Bookmark") : null}
    </Button>
  );
}

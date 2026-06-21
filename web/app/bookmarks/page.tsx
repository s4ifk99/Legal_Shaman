import { BookmarksPageClient } from "@/components/bookmarks/bookmarks-page-client";

export const metadata = {
  title: "Bookmarks | Legal Shaman",
  description: "Your saved law firms and legal providers.",
};

export default function BookmarksPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="mb-2 font-serif text-3xl font-semibold text-primary">Bookmarks</h1>
        <p className="mb-8 text-sm text-muted-foreground">
          Your shortlist of saved firms. Bookmark providers from search results to build your list.
        </p>
        <BookmarksPageClient />
      </div>
    </div>
  );
}

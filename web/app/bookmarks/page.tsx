import { BookmarksPageClient } from "@/components/bookmarks/bookmarks-page-client";
import { Footer } from "@/components/footer";
import { Header } from "@/components/header";

export const metadata = {
  title: "Bookmarks | Legal Shaman",
  description: "Your saved law firms and legal providers.",
};

export default function BookmarksPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Header />
      <div className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
        <h1 className="mb-2 font-serif text-3xl font-semibold text-primary">Bookmarks</h1>
        <p className="mb-8 text-sm text-muted-foreground">
          Your shortlist of saved firms. Bookmark providers from search results to build your list.
        </p>
        <BookmarksPageClient />
      </div>
      <Footer />
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Phone, Mail, MapPin, Globe, ExternalLink, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getCategoryInfo, getListingsBySubcategory, type Listing } from "@/lib/data";
import { inferPracticeAreaSlugFromText } from "@/lib/legal/taxonomy";
import { searchListingsInCategory } from "@/lib/legal-search/category-listing-search";

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{ q?: string }>;
};

export default async function CategoryPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const sp = (await searchParams) ?? {};
  const filterQ = (sp.q || "").trim();
  const categoryInfo = getCategoryInfo(slug);

  if (!categoryInfo) {
    notFound();
  }

  let listings = getListingsBySubcategory(slug);
  if (filterQ.length >= 2) {
    listings = await searchListingsInCategory(slug, filterQ, listings);
    const hint = inferPracticeAreaSlugFromText(filterQ);
    if (hint) {
      const match = (l: Listing) =>
        l.description.toLowerCase().includes(hint.replace(/_/g, " ")) ||
        l.subcategory.toLowerCase().includes(hint.replace(/_/g, "-"));
      listings = [...listings].sort((a, b) => Number(match(b)) - Number(match(a)));
    }
  }
  const freeListings = listings.filter((l) => l.isFree);
  const paidListings = listings.filter((l) => !l.isFree);

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-4xl px-4 py-8">
        {/* Breadcrumb */}
        <div className="mb-6">
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Directory
          </Link>
        </div>

        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
            <span>{categoryInfo.parentCategory}</span>
          </div>
          <h1 className="text-3xl font-bold text-foreground mb-2">
            {categoryInfo.name}
          </h1>
          {categoryInfo.isFree && (
            <Badge className="bg-green-100 text-green-800">
              Free Services Category
            </Badge>
          )}
          <p className="mt-4 text-muted-foreground">
            Find trusted {categoryInfo.name.toLowerCase()} services across the United Kingdom. 
            {freeListings.length > 0 && ` ${freeListings.length} free services available.`}
          </p>
          <form className="mt-6 flex max-w-lg flex-col gap-2 sm:flex-row sm:items-center" method="get" action="">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                name="q"
                defaultValue={filterQ}
                placeholder="Filter this category…"
                className="h-10 border-primary/20 pl-9"
                aria-label="Filter listings in this category"
              />
            </div>
            <Button type="submit" variant="secondary" className="h-10 shrink-0">
              Filter
            </Button>
          </form>
          {filterQ.length > 0 && filterQ.length < 2 && (
            <p className="mt-2 text-xs text-muted-foreground">Use at least 2 characters to filter.</p>
          )}
        </div>

        {/* Free Services Section */}
        {freeListings.length > 0 && (
          <section className="mb-10">
            <h2 className="text-xl font-semibold text-foreground mb-4 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-green-500" />
              Free Legal Services
            </h2>
            <div className="space-y-4">
              {freeListings.map((listing) => (
                <ListingCard key={listing.id} listing={listing} />
              ))}
            </div>
          </section>
        )}

        {/* Paid Services Section */}
        {paidListings.length > 0 && (
          <section className="mb-10">
            <h2 className="text-xl font-semibold text-foreground mb-4">
              Professional Services
            </h2>
            <div className="space-y-4">
              {paidListings.map((listing) => (
                <ListingCard key={listing.id} listing={listing} />
              ))}
            </div>
          </section>
        )}

        {/* Empty State */}
        {listings.length === 0 && (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground mb-4">
                No listings found for this category yet.
              </p>
              <Button asChild>
                <Link href="/submit">List Your Business</Link>
              </Button>
            </CardContent>
          </Card>
        )}

        {/* CTA */}
        <Card className="mt-8 bg-secondary/50">
          <CardContent className="py-6 text-center">
            <h3 className="font-semibold text-foreground mb-2">
              Do you offer {categoryInfo.name.toLowerCase()} services?
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              List your business on Legal Shaman and reach people seeking assistance.
            </p>
            <Button asChild>
              <Link href="/submit">Submit Your Listing</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ListingCard({ listing }: { listing: Listing }) {
  const addressParts = [listing.address, listing.city, listing.postcode]
    .map((p) => (p || "").trim())
    .filter(Boolean);
  const addressLine = addressParts.join(", ");

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        <div className="p-5">
          {/* Header */}
          <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
            <div>
              <h3 className="font-semibold text-foreground text-lg">
                {listing.businessName}
              </h3>
              <p className="text-sm text-muted-foreground">
                {listing.contactName}
              </p>
            </div>
            <div className="flex gap-2">
              {listing.isFree && (
                <Badge className="bg-green-100 text-green-800">Free</Badge>
              )}
              {listing.isLegalAid && (
                <Badge
                  variant="outline"
                  className="border-primary/30 text-primary"
                >
                  Legal Aid *
                </Badge>
              )}
              {listing.isSponsored && (
                <Badge variant="outline" className="border-muted-foreground/30 text-muted-foreground">
                  Sponsored
                </Badge>
              )}
            </div>
          </div>

          {/* Description */}
          <p className="text-sm text-muted-foreground mb-4">
            {listing.description}
          </p>

          {/* Contact Info */}
          <div className="grid gap-2 sm:grid-cols-2">
            {listing.phone && (
              <a
                href={`tel:${listing.phone}`}
                className="flex items-center gap-2 text-sm text-accent hover:underline"
              >
                <Phone className="h-4 w-4 shrink-0" />
                {listing.phone}
              </a>
            )}
            {listing.email && (
              <a
                href={`mailto:${listing.email}`}
                className="flex items-center gap-2 text-sm text-accent hover:underline"
              >
                <Mail className="h-4 w-4 shrink-0" />
                {listing.email}
              </a>
            )}
          </div>

          {/* Address */}
          {addressLine && (
            <div className="mt-3 flex items-start gap-2 text-sm text-muted-foreground">
              <MapPin className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{addressLine}</span>
            </div>
          )}

          {/* Website */}
          {listing.website && (
            <div className="mt-3">
              <a
                href={listing.website}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-accent hover:underline"
              >
                <Globe className="h-4 w-4" />
                Visit Website
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { WikiCrumb } from "@/lib/wiki/hubs";

const BASE = "https://www.legalshaman.com";

/** Visible breadcrumb trail plus BreadcrumbList structured data. */
export function WikiBreadcrumbs({
  crumbs,
  current,
  currentHref,
}: {
  crumbs: WikiCrumb[];
  current: string;
  currentHref: string;
}) {
  const items = [...crumbs, { label: current, href: currentHref }];
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.label,
      item: `${BASE}${item.href}`,
    })),
  };
  return (
    <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
      <ol className="flex flex-wrap items-center gap-1">
        {crumbs.map((crumb) => (
          <li key={crumb.href} className="flex items-center gap-1">
            <Link href={crumb.href} className="hover:text-foreground hover:underline">
              {crumb.label}
            </Link>
            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          </li>
        ))}
        <li aria-current="page" className="text-foreground">
          {current}
        </li>
      </ol>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
    </nav>
  );
}

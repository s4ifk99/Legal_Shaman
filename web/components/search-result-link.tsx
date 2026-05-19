"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import { logSearchResultClick } from "@/components/search-analytics";
import type { SearchResultSource } from "@/lib/search-events/types";

type Props = Omit<ComponentProps<typeof Link>, "onClick"> & {
  listingId: string;
  position: number;
  q: string;
  resultSource?: SearchResultSource;
  parsedPracticeArea?: string;
  parsedLocation?: string;
  /** Off-site profile (e.g. SRA) — opens in a new tab. */
  openInNewTab?: boolean;
  clickEventType?: "result_click" | "website_click";
};

export function SearchResultLink({
  listingId,
  position,
  q,
  resultSource = "curated_listing",
  parsedPracticeArea,
  parsedLocation,
  openInNewTab,
  clickEventType,
  href,
  className,
  children,
  ...rest
}: Props) {
  const onClick = () =>
    logSearchResultClick({
      listingId,
      position,
      q,
      resultSource,
      parsedPracticeArea,
      parsedLocation,
      eventType: clickEventType ?? (openInNewTab ? "website_click" : "result_click"),
    });
  if (openInNewTab) {
    return (
      <a
        href={typeof href === "string" ? href : String(href)}
        className={className}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onClick}
      >
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={className} {...rest} onClick={onClick}>
      {children}
    </Link>
  );
}

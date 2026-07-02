import Link from "next/link";
import type { ReactNode } from "react";

export function isInternalHref(href: string): boolean {
  return href.startsWith("/") && !href.startsWith("//");
}

type ResourceAnchorProps = {
  href: string;
  className?: string;
  children: ReactNode;
};

/** Renders internal routes with Next.js Link; external URLs open in a new tab. */
export function ResourceAnchor({ href, className, children }: ResourceAnchorProps) {
  if (isInternalHref(href)) {
    return (
      <Link href={href} className={className}>
        {children}
      </Link>
    );
  }

  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
    </a>
  );
}

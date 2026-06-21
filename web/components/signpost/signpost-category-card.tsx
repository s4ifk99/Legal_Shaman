"use client";

import { ChevronDown } from "lucide-react";
import type { SignpostCategory } from "@/lib/signpost/signpost-categories";

type SignpostCategoryCardProps = {
  category: SignpostCategory;
  defaultOpen?: boolean;
  forceOpen?: boolean;
};

export function SignpostCategoryCard({
  category,
  defaultOpen = false,
  forceOpen = false,
}: SignpostCategoryCardProps) {
  return (
    <details
      className="group rounded-xl border border-gold/30 bg-card shadow-sm"
      {...(forceOpen ? { open: true } : defaultOpen ? { defaultOpen: true } : {})}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-4 marker:content-none md:px-5">
        <div className="min-w-0">
          <h3 className="font-serif text-lg font-semibold text-foreground md:text-xl">{category.title}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{category.description}</p>
        </div>
        <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>

      <div className="border-t border-gold/20 px-4 pb-4 pt-3 md:px-5">
        {category.links.length === 0 ? (
          <p className="text-sm text-muted-foreground">Useful links coming soon.</p>
        ) : (
          <ul className="space-y-3">
            {category.links.map((link) => (
              <li key={`${category.slug}-${link.label}-${link.url}`} className="text-sm">
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-primary hover:underline"
                >
                  {link.label}
                </a>
                {link.note ? <p className="mt-1 text-muted-foreground">{link.note}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}

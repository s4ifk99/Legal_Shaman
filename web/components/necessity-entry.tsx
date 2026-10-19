"use client";

import { captureProductEvent } from "@/components/analytics/posthog-provider";
import { NECESSITY_CATEGORIES, necessitySearchHref } from "@/lib/necessity/categories";
import { cn } from "@/lib/utils";

export function NecessityEntry() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {NECESSITY_CATEGORIES.map((category) => (
        <a
          key={category.slug}
          href={necessitySearchHref(category)}
          onClick={() => captureProductEvent("necessity_selected", { slug: category.slug })}
          className={cn(
            "group flex h-full flex-col rounded-2xl border-2 border-border bg-card p-5 text-left shadow-sm transition-all duration-200",
            "hover:-translate-y-0.5 hover:border-primary hover:shadow-md",
          )}
        >
          <h3 className="font-serif text-lg font-semibold text-foreground group-hover:text-primary">
            {category.title}
          </h3>
          <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">{category.need}</p>
        </a>
      ))}
    </div>
  );
}

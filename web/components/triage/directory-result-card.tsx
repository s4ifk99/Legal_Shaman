import type { SearchResult } from "@/lib/legal-search/types";
import { sourceProvenanceLabel } from "@/lib/legal-search/orchestration/source-provenance";
import { cn } from "@/lib/utils";

type DirectoryResultCardProps = {
  result: SearchResult;
  selected?: boolean;
};

export function DirectoryResultCard({ result, selected }: DirectoryResultCardProps) {
  const provenance = sourceProvenanceLabel(result);

  return (
    <article
      data-entity-id={result.id}
      className={cn(
        "rounded-lg border bg-card p-4 shadow-sm transition-colors",
        selected && "border-primary ring-1 ring-primary",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="font-medium text-foreground">{result.title}</h3>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          {provenance}
        </span>
      </div>
      {result.practiceAreas.length > 0 ? (
        <p className="mt-1 text-sm text-muted-foreground">
          {result.practiceAreas.slice(0, 4).join(" · ")}
        </p>
      ) : null}
      {result.location?.city ? (
        <p className="mt-1 text-xs text-muted-foreground">{result.location.city}</p>
      ) : null}
      {result.description ? (
        <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{result.description}</p>
      ) : null}
      {result.explanation ? (
        <p className="mt-2 text-sm leading-relaxed text-foreground/90">{result.explanation}</p>
      ) : null}
      {(result.contact?.website || result.url) && (
        <p className="mt-3">
          <a
            href={result.contact?.website ?? result.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-primary hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            Visit website
          </a>
        </p>
      )}
    </article>
  );
}

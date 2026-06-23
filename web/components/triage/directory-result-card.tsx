import type { SearchResult } from "@/lib/legal-search/types";
import { PublicResultCard } from "@/components/search/public-result-card";

type DirectoryResultCardProps = {
  result: SearchResult;
  selected?: boolean;
  hideContactLinks?: boolean;
};

export function DirectoryResultCard({ result, selected, hideContactLinks }: DirectoryResultCardProps) {
  return <PublicResultCard result={result} selected={selected} hideContactLinks={hideContactLinks} />;
}

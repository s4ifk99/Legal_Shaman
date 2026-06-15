import type { SearchResult } from "@/lib/legal-search/types";
import { PublicResultCard } from "@/components/search/public-result-card";

type DirectoryResultCardProps = {
  result: SearchResult;
  selected?: boolean;
};

export function DirectoryResultCard({ result, selected }: DirectoryResultCardProps) {
  return <PublicResultCard result={result} selected={selected} />;
}

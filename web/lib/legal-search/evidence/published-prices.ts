import type { PublishedPriceRecord } from "@/lib/legal-search/evidence/types";
import { isAcceptablePublishedPrice } from "@/lib/legal-search/evidence/published-price-validate";
import { lookupPublishedPriceFromStore } from "@/lib/legal-search/evidence/published-price-store";

export { isAcceptablePublishedPrice };

/**
 * Verified prices from a provider's own published pricing page.
 * Durable JSON store starts empty; offline harvest fills it. Search never invents a fee.
 */
export function lookupPublishedPrice(resultId: string): PublishedPriceRecord | null {
  return lookupPublishedPriceFromStore(resultId);
}

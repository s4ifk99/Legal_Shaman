import { planOsintSteps, OSINT_SOURCE_LADDER } from "@/lib/provider-osint/source-ladder";
import type { LadderSourceStep } from "@/lib/provider-enrichment-ladder/types";
import type { LegalEntityDocument } from "@/lib/search-index/types";

/** @deprecated Use OSINT_SOURCE_LADDER — kept for compatibility. */
export const LADDER_SOURCE_ORDER = OSINT_SOURCE_LADDER as unknown as LadderSourceStep[];

export function planLadderSteps(doc: LegalEntityDocument): LadderSourceStep[] {
  return planOsintSteps(doc) as unknown as LadderSourceStep[];
}

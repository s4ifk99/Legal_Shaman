import {
  extractFirmNameFromSraSearchText,
  isPlaceholderSraBusinessName,
  type SraNameFields,
} from "@/lib/search/sra-display";

export type SraNameCandidateRow = SraNameFields & {
  displayName?: string | null;
  businessName?: string | null;
  authorisationName?: string | null;
  recognisedBodyName?: string | null;
};

function pickFirstRealName(candidates: (string | null | undefined)[], sraId: string): string | null {
  for (const c of candidates) {
    const t = c?.trim();
    if (t && !isPlaceholderSraBusinessName(t, sraId)) return t;
  }
  return null;
}

/**
 * Index/UI title priority (never Organisation &lt;id&gt; when a real name exists).
 */
export function pickSraIndexTitle(
  sraId: string,
  searchText: string,
  fields: SraNameCandidateRow,
): string {
  const picked = pickFirstRealName(
    [
      fields.displayName,
      fields.tradingName,
      fields.organisationName,
      fields.firmName,
      fields.name,
      fields.authorisationName,
      fields.recognisedBodyName,
      fields.businessName,
      fields.title,
    ],
    sraId,
  );
  if (picked) return picked;

  const fromText = extractFirmNameFromSraSearchText(searchText, sraId);
  if (fromText) return fromText;

  return `SRA organisation ${sraId}`;
}

export function isSraPlaceholderTitle(title: string): boolean {
  return /^Organisation\s+\d+$/i.test(title.trim());
}

/**
 * Identity match for linking review APIs to a firm listing.
 * Strong: website host match, or normalised name plus postcode.
 */

function stripLegalSuffixes(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(llp|ltd|limited|solicitors?|lawyers?|law\s+firm|the)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function websiteHost(url: string | null | undefined): string | null {
  if (!url?.trim()) return null;
  try {
    const host = new URL(url.includes("://") ? url : `https://${url}`).hostname
      .toLowerCase()
      .replace(/^www\./, "");
    return host || null;
  } catch {
    return null;
  }
}

export function normalizePostcode(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  const compact = value.toUpperCase().replace(/\s+/g, "");
  return compact.length >= 5 ? compact : null;
}

export type IdentityMatchInput = {
  firmName: string;
  firmPostcode?: string | null;
  firmWebsite?: string | null;
  candidateName?: string | null;
  candidatePostcode?: string | null;
  candidateWebsite?: string | null;
};

export type IdentityMatchResult = {
  strong: boolean;
  reason: string;
  score: number;
};

export function matchFirmIdentity(input: IdentityMatchInput): IdentityMatchResult {
  const firmHost = websiteHost(input.firmWebsite);
  const candidateHost = websiteHost(input.candidateWebsite);
  if (firmHost && candidateHost && firmHost === candidateHost) {
    return { strong: true, reason: "website_host", score: 0.98 };
  }

  const firmName = stripLegalSuffixes(input.firmName);
  const candidateName = stripLegalSuffixes(input.candidateName ?? "");
  const nameOk =
    Boolean(firmName) &&
    Boolean(candidateName) &&
    (firmName === candidateName ||
      firmName.includes(candidateName) ||
      candidateName.includes(firmName));

  const firmPc = normalizePostcode(input.firmPostcode);
  const candidatePc = normalizePostcode(input.candidatePostcode);
  const postcodeOk = Boolean(firmPc && candidatePc && firmPc === candidatePc);

  if (nameOk && postcodeOk) {
    return { strong: true, reason: "name_and_postcode", score: 0.96 };
  }
  if (nameOk && firmHost && candidateHost && (firmHost.endsWith(candidateHost) || candidateHost.endsWith(firmHost))) {
    return { strong: true, reason: "name_and_related_host", score: 0.94 };
  }
  if (nameOk) {
    return { strong: false, reason: "name_only", score: 0.7 };
  }
  return { strong: false, reason: "no_match", score: 0.2 };
}

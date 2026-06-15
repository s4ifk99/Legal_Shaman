import { firmNameTokens, normalizeFirmName } from "@/lib/provider-osint/name-normalize";
import { normalisePostcode } from "@/lib/search-index/normalise-address";

export const SYNTHETIC_REJECT_REASON = "synthetic_generated_domain";

/** @deprecated Use SYNTHETIC_REJECT_REASON */
export const LEGACY_SYNTHETIC_REJECT_REASON = "synthetic_domain_not_provider_website";

export type SyntheticDomainProviderContext = {
  firmName?: string;
  displayName?: string;
  sraId?: string;
  postcode?: string;
  city?: string;
};

export type SyntheticDomainResult = {
  synthetic: boolean;
  reason?: string;
};

const GEO_BLOB_HOST_RE =
  /(unitedarabemirates|unitedkingdom|unitedstates|england|scotland|wales|northernireland|greece|kenya|uae|emirates)/i;

const CITY_PREFIX_RE =
  /^(dubai|abudhabi|nairobi|piraeus|athens|london|manchester|birmingham|sheffield|leeds|glasgow|edinburgh|bristol|liverpool|cardiff|belfast|newcastle|nottingham|leicester|coventry|plymouth|southampton|reading|oxford|cambridge|york|hull|stoke|wolverhampton|derby|swansea|aberdeen|dundee|inverness)/i;

const UK_POSTCODE_TAIL_RE = /[a-z]{1,2}\d{1,2}[a-z]\d[a-z]{2}$/i;

/** Known-bad synthetic URLs from evals and production cleanup. */
const KNOWN_SYNTHETIC_URLS = new Set([
  "https://www.dubaiunitedarabemirates.co.uk",
  "https://www.nairobikenya.co.uk",
  "https://www.londonsw1p3js.co.uk",
  "https://www.londonsw1e5by.co.uk",
  "https://www.abudhabiunitedarabemirates.co.uk",
  "https://www.piraeus185greece.co.uk",
  "https://www.sra1002232.co.uk",
]);

function parseHostCompact(url: string): string | null {
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`)
      .hostname.toLowerCase()
      .replace(/^www\./, "")
      .replace(/[^a-z0-9]/g, "");
  } catch {
    return null;
  }
}

function hostHasUkPostcodeBlob(hostCompact: string): boolean {
  if (!UK_POSTCODE_TAIL_RE.test(hostCompact)) return false;
  const withoutPc = hostCompact.replace(UK_POSTCODE_TAIL_RE, "");
  return withoutPc.length >= 4 && CITY_PREFIX_RE.test(withoutPc);
}

function hostIsGeographicSlug(hostCompact: string): boolean {
  if (GEO_BLOB_HOST_RE.test(hostCompact)) return true;
  if (hostHasUkPostcodeBlob(hostCompact)) return true;

  const m = hostCompact.match(CITY_PREFIX_RE);
  if (m) {
    const rest = hostCompact.slice(m[0].length);
    if (rest.length >= 3 && (/^\d/.test(rest) || GEO_BLOB_HOST_RE.test(rest))) {
      return true;
    }
  }

  return false;
}

/** Fast pattern check — no firm name required (persist gate + cleanup). */
export function isObviouslySyntheticGeneratedUrl(url: string): SyntheticDomainResult {
  const normalised = url.trim().toLowerCase().replace(/\/$/, "");
  if (KNOWN_SYNTHETIC_URLS.has(normalised)) {
    return { synthetic: true, reason: "known_synthetic_url" };
  }

  const hostCompact = parseHostCompact(url);
  if (!hostCompact) return { synthetic: true, reason: "invalid_url" };

  if (/^sra\d+$/i.test(hostCompact)) {
    return { synthetic: true, reason: "sra_id_domain" };
  }

  if (/^\d{5,}$/.test(hostCompact)) {
    return { synthetic: true, reason: "numeric_only_domain" };
  }

  if (hostIsGeographicSlug(hostCompact)) {
    return { synthetic: true, reason: "geographic_blob_domain" };
  }

  return { synthetic: false };
}

/**
 * Detect domains constructed from address/location tokens rather than discovered firm websites.
 */
export function isSyntheticGeneratedDomain(
  url: string,
  provider?: SyntheticDomainProviderContext,
): SyntheticDomainResult {
  const obvious = isObviouslySyntheticGeneratedUrl(url);
  if (obvious.synthetic) return obvious;

  const firmName = provider?.firmName?.trim() || provider?.displayName?.trim() || "";
  return isSyntheticWebsiteDomain(url, firmName, {
    postcode: provider?.postcode,
    city: provider?.city,
    sraId: provider?.sraId,
  });
}

/** Domains guessed from SRA id, postcode, or city — never valid firm websites. */
export function isSyntheticWebsiteDomain(
  url: string,
  firmName: string,
  ctx?: { postcode?: string; city?: string; sraId?: string },
): SyntheticDomainResult {
  let hostname = "";
  try {
    hostname = new URL(url.startsWith("http") ? url : `https://${url}`)
      .hostname.toLowerCase()
      .replace(/^www\./, "");
  } catch {
    return { synthetic: true, reason: "invalid_url" };
  }

  const hostCompact = hostname.replace(/[^a-z0-9]/g, "");

  if (/^sra\d+(\.|$)/i.test(hostname) || /^www\.sra\d+\./i.test(`www.${hostname}`)) {
    return { synthetic: true, reason: "sra_id_domain" };
  }

  if (/^\d{5,}$/.test(hostCompact)) {
    return { synthetic: true, reason: "numeric_only_domain" };
  }

  if (ctx?.sraId) {
    const sid = ctx.sraId.replace(/^sra:/i, "");
    if (hostCompact === sid || hostCompact === `sra${sid}`) {
      return { synthetic: true, reason: "sra_id_in_domain" };
    }
  }

  const tokens = firmNameTokens(firmName).filter((t) => t.length >= 3);
  const matchedTokenCount = tokens.filter((t) => hostCompact.includes(t)).length;

  if (ctx?.postcode) {
    try {
      const pc = normalisePostcode(ctx.postcode).replace(/\s/g, "").toLowerCase();
      if (pc.length >= 5 && hostCompact.includes(pc) && matchedTokenCount === 0) {
        return { synthetic: true, reason: "postcode_domain_without_firm_name" };
      }
      const outward = pc.slice(0, -3);
      if (outward.length >= 2 && hostCompact.includes(outward) && matchedTokenCount === 0) {
        return { synthetic: true, reason: "postcode_outward_domain_without_firm_name" };
      }
    } catch {
      /* ignore */
    }
  }

  if (ctx?.city) {
    const cityNorm = normalizeFirmName(ctx.city).replace(/\s/g, "");
    if (
      cityNorm.length >= 4 &&
      hostCompact.includes(cityNorm) &&
      matchedTokenCount === 0 &&
      hostCompact.length < cityNorm.length + 10
    ) {
      return { synthetic: true, reason: "city_only_domain" };
    }
  }

  if (hostIsGeographicSlug(hostCompact) && matchedTokenCount === 0) {
    return { synthetic: true, reason: "geographic_blob_domain" };
  }

  if (tokens.length >= 2 && matchedTokenCount === 0 && hostCompact.length <= 28) {
    return { synthetic: true, reason: "no_firm_name_token_in_domain" };
  }

  return { synthetic: false };
}

export function isSyntheticWebsiteUrl(
  url: string,
  firmName: string,
  ctx?: { postcode?: string; city?: string; sraId?: string },
): boolean {
  return isSyntheticWebsiteDomain(url, firmName, ctx).synthetic;
}

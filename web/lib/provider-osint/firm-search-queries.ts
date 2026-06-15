import type { FirmNameSeed } from "@/lib/provider-osint/firm-name-seed";
import { firmNameLooksLikeSraId } from "@/lib/provider-osint/firm-name-seed";
import { rejectFirmNameSeed } from "@/lib/provider-osint/firm-name-seed-validation";

const GEO_ONLY_CITY_RE =
  /^(london|manchester|birmingham|leeds|glasgow|edinburgh|bristol|liverpool|sheffield|cardiff|belfast|dubai|abu dhabi|united arab emirates)$/i;

function isUsefulLocationCity(city?: string): boolean {
  if (!city?.trim()) return false;
  const c = city.trim();
  if (c.length < 3 || c.length > 40) return false;
  if (GEO_ONLY_CITY_RE.test(c)) return true;
  if (/united arab emirates|england|scotland|wales/i.test(c) && c.length > 20) return false;
  return !/^\d+$/.test(c);
}

function isUkPostcode(postcode?: string): boolean {
  if (!postcode?.trim()) return false;
  return /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i.test(postcode.trim());
}

/**
 * Build web search queries from the real firm name (+ optional location in query text only).
 * Never embeds SRA id, raw postcode, or city as domain seeds.
 */
export function buildFirmWebsiteSearchQueries(seed: FirmNameSeed): string[] {
  const sraId = seed.sraId ?? "";
  if (firmNameLooksLikeSraId(seed.primaryName, sraId)) return [];
  if (!rejectFirmNameSeed(seed.primaryName, sraId).valid) return [];

  const name = seed.primaryName.trim();
  const quoted = `"${name}"`;
  const queries = new Set<string>();

  queries.add(`${quoted} solicitors`);
  queries.add(`${quoted} contact`);
  queries.add(`${quoted} law firm`);
  queries.add(`${name} solicitors UK`);

  if (isUsefulLocationCity(seed.city)) {
    queries.add(`${quoted} ${seed.city!.trim()}`);
    queries.add(`${name} solicitors ${seed.city!.trim()}`);
  }

  if (isUkPostcode(seed.postcode)) {
    queries.add(`${quoted} ${seed.postcode!.trim().toUpperCase()}`);
  }

  return [...queries].slice(0, 6);
}

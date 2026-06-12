import { buildSingleSraDocument } from "@/lib/search-index/build-legal-entity-doc";
import { enrichFirmNameSeedFromPostgres } from "@/lib/provider-osint/firm-name-seed";
import {
  isObviouslySyntheticGeneratedUrl,
  isSyntheticGeneratedDomain,
  SYNTHETIC_REJECT_REASON,
} from "@/lib/provider-osint/synthetic-domain";

/** Reject synthetic website values before provider_enrichments insert. */
export async function rejectSyntheticWebsiteCandidate(
  entityId: string,
  url: string,
): Promise<{ reject: true; reason: string } | { reject: false }> {
  const obvious = isObviouslySyntheticGeneratedUrl(url);
  if (obvious.synthetic) {
    return { reject: true, reason: SYNTHETIC_REJECT_REASON };
  }

  const doc = (await buildSingleSraDocument(entityId, { skipGeo: true })) ?? null;
  const seed = doc ? await enrichFirmNameSeedFromPostgres(doc) : null;

  const check = isSyntheticGeneratedDomain(url, {
    firmName: seed?.primaryName,
    displayName: seed?.primaryName,
    sraId: seed?.sraId,
    postcode: seed?.postcode,
    city: seed?.city,
  });
  if (check.synthetic) {
    return { reject: true, reason: SYNTHETIC_REJECT_REASON };
  }

  return { reject: false };
}

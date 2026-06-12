import { buildSingleSraDocument } from "@/lib/search-index/build-legal-entity-doc";
import type { LegalEntityDocument } from "@/lib/search-index/types";
import {
  extractFirmNameFromSraSearchText,
  isPlaceholderSraBusinessName,
} from "@/lib/search/sra-display";
import { pickNameFromDbRow, type SraDbNameRow } from "@/lib/sra/runtime-name-repair";
import { recoverSraOrganisationNameIfPlaceholder } from "@/lib/sra/register-name-backfill";
import { isValidFirmNameSeed } from "@/lib/provider-osint/firm-name-seed-validation";
import { isPlaceholderSraDisplayName } from "@/lib/sra/sra-name-quality";

export type FirmNameSeed = {
  primaryName: string;
  nameSources: string[];
  sraId?: string;
  city?: string;
  postcode?: string;
  county?: string;
};

function collectNameCandidates(doc: LegalEntityDocument, sraId: string): string[] {
  const out: string[] = [];
  const push = (v?: string | null) => {
    const t = v?.trim();
    if (!t || isPlaceholderSraBusinessName(t, sraId)) return;
    if (!isValidFirmNameSeed(t, sraId)) return;
    if (!out.includes(t)) out.push(t);
  };

  push(doc.displayName);
  push(doc.organisationName);
  push(doc.tradingName);
  push(doc.firmName);
  push(doc.title);
  push(doc.exactTitle);

  const fromSearch = extractFirmNameFromSraSearchText(doc.searchText ?? "", sraId);
  push(fromSearch);

  return out;
}

export function sraIdFromEntityId(entityId: string): string {
  return entityId.replace(/^sra:/i, "").replace(/^sra-/i, "").trim();
}

/** Resolve the firm display name used for website search (never SRA id). */
export function resolveFirmNameSeed(doc: LegalEntityDocument): FirmNameSeed | null {
  const sraId = doc.sraId ?? doc.sraNumber ?? sraIdFromEntityId(doc.id);
  const candidates = collectNameCandidates(doc, sraId);
  if (!candidates.length) return null;

  const primaryName = candidates.find((n) => !firmNameLooksLikeSraId(n, sraId));
  if (!primaryName || firmNameLooksLikeSraId(primaryName, sraId)) return null;
  if (!isValidFirmNameSeed(primaryName, sraId)) return null;

  return {
    primaryName,
    nameSources: candidates,
    sraId,
    city: doc.city?.trim() || undefined,
    postcode: doc.postcode?.trim() || undefined,
  };
}

/** Load freshest Postgres name columns when index doc title is still a placeholder. */
export async function enrichFirmNameSeedFromPostgres(
  doc: LegalEntityDocument,
): Promise<FirmNameSeed | null> {
  const sraId = doc.sraId ?? sraIdFromEntityId(doc.id);
  let seed = resolveFirmNameSeed(doc);

  const needsDb =
    !seed ||
    isPlaceholderSraBusinessName(seed.primaryName, sraId) ||
    isPlaceholderSraDisplayName(seed.primaryName, sraId);

  if (needsDb) {
    try {
      const { prisma } = await import("@/lib/db/prisma");
      const approved = await prisma.sraIdentityCandidate.findFirst({
        where: {
          sraId,
          status: { in: ["auto_approved", "pending_review"] },
          candidateName: { not: "" },
        },
        orderBy: { confidence: "desc" },
        select: {
          candidateName: true,
          sourceType: true,
          sourceUrl: true,
          confidence: true,
        },
      });
      const approvedName = approved?.candidateName?.trim();
      if (approvedName && isValidFirmNameSeed(approvedName, sraId)) {
        return {
          primaryName: approvedName,
          nameSources: [approvedName],
          sraId,
          city: doc.city?.trim() || undefined,
          postcode: doc.postcode?.trim() || undefined,
        };
      }
    } catch {
      /* optional */
    }

    const recovered = await recoverSraOrganisationNameIfPlaceholder(doc.id, {
      persist: true,
    });
    if (recovered?.displayName && isValidFirmNameSeed(recovered.displayName, sraId)) {
      return {
        primaryName: recovered.displayName,
        nameSources: [recovered.displayName],
        sraId: recovered.sraId,
        city: doc.city?.trim() || undefined,
        postcode: doc.postcode?.trim() || undefined,
      };
    }
  }

  if (!needsDb) return seed;

  const fresh = await buildSingleSraDocument(doc.id, { skipGeo: true });
  if (fresh) {
    seed = resolveFirmNameSeed(fresh);
    if (
      seed &&
      !isPlaceholderSraBusinessName(seed.primaryName, sraId) &&
      isValidFirmNameSeed(seed.primaryName, sraId)
    ) {
      return seed;
    }
  }

  try {
    const { prisma } = await import("@/lib/db/prisma");
    const row = await prisma.sraOrganisation.findFirst({
      where: { OR: [{ sraId }, { id: doc.id }] },
      select: {
        sraId: true,
        displayName: true,
        organisationName: true,
        tradingName: true,
        firmName: true,
        businessName: true,
        searchText: true,
        city: true,
        postcode: true,
      },
    });
    if (!row) return seed;

    const dbRow: SraDbNameRow = {
      sraId: row.sraId,
      displayName: row.displayName,
      organisationName: row.organisationName,
      tradingName: row.tradingName,
      firmName: row.firmName,
      businessName: row.businessName,
      searchText: row.searchText,
    };
    const picked = pickNameFromDbRow(dbRow, row.sraId);
    if (!picked || !isValidFirmNameSeed(picked, row.sraId)) return seed;

    return {
      primaryName: picked,
      nameSources: collectNameCandidates(
        { ...doc, displayName: picked, title: picked },
        row.sraId,
      ),
      sraId: row.sraId,
      city: row.city?.trim() || doc.city,
      postcode: row.postcode?.trim() || doc.postcode,
    };
  } catch {
    return seed;
  }
}

export function firmNameLooksLikeSraId(name: string, sraId?: string): boolean {
  const n = name.trim();
  if (!n) return true;
  if (sraId && (n === sraId || n === `sra:${sraId}`)) return true;
  if (/^Organisation\s+\d+$/i.test(n)) return true;
  if (/^\d{5,}$/.test(n)) return true;
  return false;
}

import type { SraOrganisation } from "@prisma/client";

import {
  classifySraStoredName,
  isAddressLikeName,
  isPlaceholderSraDisplayName,
} from "@/lib/sra/sra-name-quality";

export function sraEntityId(sraId: string): string {
  return `sra:${sraId}`;
}

export function isDeletableSraRow(org: Pick<SraOrganisation, "displayName" | "sraId">): boolean {
  const name = org.displayName.trim();
  if (!name) return true;
  if (isPlaceholderSraDisplayName(name, org.sraId)) return true;
  if (isAddressLikeName(name)) return true;
  return classifySraStoredName(name, org.sraId) !== "real_firm_name";
}

export function keeperScore(org: SraOrganisation): number {
  const nameClass = classifySraStoredName(org.displayName, org.sraId);
  let score = 0;
  if (nameClass === "real_firm_name") score += 100;
  if (org.organisationName.trim()) score += 20;
  const raw = org.rawPayload as Record<string, unknown> | null;
  const sraNumber = raw?.SraNumber ?? raw?.sraNumber;
  if (sraNumber != null && String(sraNumber) === org.sraId) score += 50;
  if (org.phone.trim()) score += 10;
  if (org.email.trim()) score += 10;
  if (org.website.trim()) score += 10;
  if (org.rawPayload) score += 15;
  if (org.offices) score += 5;
  return score;
}

export function isStrongKeeper(org: SraOrganisation): boolean {
  if (!isDeletableSraRow(org)) {
    return keeperScore(org) >= 100;
  }
  return false;
}

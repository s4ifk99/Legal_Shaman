import { prisma } from "@/lib/db/prisma";

/**
 * Match existing `firms` rows (e.g. those created by the seed) to SRA
 * organisations by normalised business name. When exactly one SRA record
 * matches, write `firm.sraId` + `firm.sraProfileUrl` + `verified = true`.
 *
 * On multi-match (ambiguous): leave the firm unlinked and log. Operators can
 * disambiguate by editing the firm row directly.
 */

const LEGAL_SUFFIXES = [
  "llp",
  "ltd",
  "limited",
  "plc",
  "solicitor",
  "solicitors",
  "law firm",
  "law office",
  "law offices",
  "associates",
  "and co",
  "& co",
];

export function normaliseFirmName(s: string): string {
  let out = (s || "").toLowerCase();
  // Strip legal suffixes (whole-word).
  for (const suf of LEGAL_SUFFIXES) {
    out = out.replace(new RegExp(`\\b${suf}\\b`, "g"), " ");
  }
  // Collapse non-alphanumerics + whitespace.
  out = out.replace(/[^a-z0-9]+/g, " ").trim();
  out = out.replace(/\s{2,}/g, " ");
  return out;
}

export type LinkResult = {
  /** Firms that got an sraId set by this run. */
  linked: number;
  /** Firms that already had an sraId or had no name. */
  skipped: number;
  /** Firms with 2+ matching SRA orgs — left unlinked. */
  ambiguous: number;
};

export async function linkFirmsToSra(): Promise<LinkResult> {
  const firms = await prisma.firm.findMany({
    where: { sraId: null },
    select: { id: true, name: true },
  });

  if (firms.length === 0) return { linked: 0, skipped: 0, ambiguous: 0 };

  // Pull all SRA org names once and bucket by normalised key.
  const orgs = await prisma.sraOrganisation.findMany({
    select: { sraId: true, businessName: true, sraProfileUrl: true, city: true, postcode: true, country: true },
  });

  const byKey = new Map<
    string,
    { sraId: string; businessName: string; sraProfileUrl: string; city: string; postcode: string; country: string }[]
  >();
  for (const o of orgs) {
    const key = normaliseFirmName(o.businessName);
    if (!key) continue;
    const list = byKey.get(key) ?? [];
    list.push(o);
    byKey.set(key, list);
  }

  let linked = 0;
  let skipped = 0;
  let ambiguous = 0;

  for (const firm of firms) {
    const key = normaliseFirmName(firm.name);
    if (!key) {
      skipped++;
      continue;
    }
    const candidates = byKey.get(key);
    if (!candidates || candidates.length === 0) {
      skipped++;
      continue;
    }
    if (candidates.length > 1) {
      console.warn(
        `[sra:link-firms] ambiguous: firm "${firm.name}" matches ${candidates.length} SRA orgs (sraIds: ${candidates
          .map((c) => c.sraId)
          .slice(0, 5)
          .join(", ")}). Leaving unlinked.`,
      );
      ambiguous++;
      continue;
    }
    const match = candidates[0]!;
    try {
      await prisma.firm.update({
        where: { id: firm.id },
        data: {
          sraId: match.sraId,
          sraProfileUrl: match.sraProfileUrl || null,
          city: match.city || null,
          postcode: match.postcode || null,
          country: match.country || null,
          verified: true,
        },
      });
      linked++;
    } catch (err) {
      const code =
        err && typeof err === "object" && "code" in err
          ? String((err as { code?: string }).code)
          : "";
      if (code === "P2002") {
        skipped++;
        continue;
      }
      throw err;
    }
  }

  return { linked, skipped, ambiguous };
}

import type { FreeResourceCandidate } from "@/lib/coherence/researchBundle";
import type { MatterType } from "@/lib/coherence/types";

type HelpHit = {
  id: string;
  url: string;
  title: string;
  excerpt: string;
};

const FREE_HOST: Array<{ re: RegExp; resourceType: FreeResourceCandidate["resourceType"] }> = [
  { re: /shelter\.org\.uk/i, resourceType: "charity" },
  { re: /citizensadvice\.org\.uk/i, resourceType: "charity" },
  { re: /acas\.org\.uk/i, resourceType: "helpline" },
  { re: /advicenow\.org\.uk/i, resourceType: "charity" },
  { re: /justicefortenants/i, resourceType: "charity" },
  { re: /lawcentres\.org\.uk/i, resourceType: "law-centre" },
  { re: /lease-advice\.org/i, resourceType: "helpline" },
  { re: /housing-ombudsman\.org\.uk/i, resourceType: "ombudsman" },
  { re: /legalombudsman\.org\.uk/i, resourceType: "ombudsman" },
  { re: /moneyhelper\.org\.uk/i, resourceType: "helpline" },
  { re: /gov\.uk\/legal-aid/i, resourceType: "legal-aid" },
  { re: /gov\.uk\/check-legal-aid/i, resourceType: "legal-aid" },
];

const PAID_HOST: Array<{ re: RegExp; resourceType: FreeResourceCandidate["resourceType"] }> = [
  { re: /sra\.org\.uk/i, resourceType: "directory" },
  { re: /lawsociety\.org\.uk/i, resourceType: "directory" },
  { re: /solicitors\.lawsociety\.org\.uk/i, resourceType: "directory" },
];

const MARKETING_FIRM =
  /taylor-rose|lawhive|harperjames|howell-jones|levisolicitors|anthonygold|keystonelaw|lyonsdavidson|attwaters|jacksonlees/i;

const HELP_PAGE =
  /get[-_ ]?help|contact|helpline|advice[-_ ]?line|find[-_ ]a[-_ ]solicitor|find[-_ ]a[-_ ]lawyer|legal[-_ ]aid|law[-_ ]centre|clinic|helpline|how[-_ ]we[-_ ]can[-_ ]help|emergency/i;

function hostPath(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname}`.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

function looksLikeHelpPage(hit: HelpHit): boolean {
  const blob = `${hit.title} ${hit.url} ${hit.excerpt}`;
  return HELP_PAGE.test(blob) || FREE_HOST.some((h) => h.re.test(hit.url)) || PAID_HOST.some((h) => h.re.test(hit.url));
}

function classify(hit: HelpHit): { costBand: "free" | "paid"; resourceType: FreeResourceCandidate["resourceType"] } | null {
  if (MARKETING_FIRM.test(hit.url)) return null;
  const path = hostPath(hit.url);
  for (const row of FREE_HOST) {
    if (row.re.test(path) || row.re.test(hit.url)) {
      return { costBand: "free", resourceType: row.resourceType };
    }
  }
  for (const row of PAID_HOST) {
    if (row.re.test(path) || row.re.test(hit.url)) {
      return { costBand: "paid", resourceType: row.resourceType };
    }
  }
  if (/law centre|lawcentre/i.test(`${hit.title} ${hit.excerpt}`)) {
    return { costBand: "free", resourceType: "law-centre" };
  }
  if (/solicitor|law firm|barrister chambers/i.test(`${hit.title} ${hit.url}`) && /find|directory|search|register/i.test(`${hit.title} ${hit.url}`)) {
    return { costBand: "paid", resourceType: "directory" };
  }
  return null;
}

function slugMatter(slug?: string): MatterType {
  const s = (slug || "unknown").split("+")[0];
  const allowed: MatterType[] = [
    "immigration",
    "personal_injury",
    "housing",
    "conveyancing",
    "employment",
    "family",
    "debt",
    "consumer",
    "crime",
    "other",
    "unknown",
  ];
  return (allowed.includes(s as MatterType) ? s : "unknown") as MatterType;
}

/** Turn Exa hits into Matching Help leads (free charities/helplines and paid directories). */
export function discoverHelpFromExaHits(
  hits: HelpHit[],
  opts: { matterSlug?: string; topicId?: string } = {},
): FreeResourceCandidate[] {
  const matterType = slugMatter(opts.matterSlug);
  const topicId = (opts.topicId || matterType).slice(0, 100);
  const seen = new Set<string>();
  const out: FreeResourceCandidate[] = [];
  for (const hit of hits) {
    if (!hit.url.startsWith("https://")) continue;
    if (!looksLikeHelpPage(hit) && !classify(hit)) continue;
    const kind = classify(hit);
    if (!kind) continue;
    const key = hit.url.replace(/\/+$/, "").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: `help-${hit.id}`.slice(0, 120),
      title: hit.title.slice(0, 240),
      description: (hit.excerpt || hit.title).replace(/\s+/g, " ").trim().slice(0, 500),
      url: hit.url,
      resourceType: kind.resourceType,
      costBand: kind.costBand,
      matterType,
      topicId,
      sourceIds: [hit.id],
      reviewStatus: "pending_review",
    });
    if (out.length >= 12) break;
  }
  return out;
}

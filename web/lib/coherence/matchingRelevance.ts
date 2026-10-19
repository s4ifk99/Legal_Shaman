/**
 * Matching help should show the dispute the person described.
 * Asylum Support Appeals Project and Housing Loss Prevention Advice are
 * parked off this list for now. Citizens Advice is one fallback, at the end.
 */

export type DisputeLens =
  | "neighbour"
  | "tenancy"
  | "parking"
  | "immigration"
  | "family"
  | "employment"
  | "debt"
  | "consumer"
  | "general";

export type DisputeContext = {
  necessitySlug?: string | null;
  taxonomySlug?: string | null;
  matterType?: string | null;
  text?: string;
};

const NEIGHBOUR = /\b(neighbour|neighbor|boundary|fence|nuisance|party wall|right of way|driveway)\b/i;
const TENANCY =
  /\b(evict|eviction|section\s*21|section\s*8|possession|landlord|tenan|deposit|disrepair|leasehold|service charge)\b/i;

export function disputeLens(input: DisputeContext): DisputeLens {
  const slug = `${input.necessitySlug || ""} ${input.taxonomySlug || ""}`.toLowerCase();
  const text = input.text || "";
  const matter = input.matterType || "";
  if (
    input.necessitySlug === "neighbour-disputes" ||
    /neighbour/.test(slug) ||
    (NEIGHBOUR.test(text) && !TENANCY.test(text))
  ) {
    return "neighbour";
  }
  if (input.necessitySlug === "pcn" || /parking|pcn/.test(slug) || /\b(parking|pcn|popla)\b/i.test(text)) {
    return "parking";
  }
  if (matter === "immigration" || (/\b(asylum|refugee|visa|home office)\b/i.test(text) && matter !== "housing")) {
    return "immigration";
  }
  if (matter === "family") return "family";
  if (matter === "employment") return "employment";
  if (matter === "debt") return "debt";
  if (matter === "consumer") return "consumer";
  if (matter === "housing" || input.necessitySlug === "property-housing" || TENANCY.test(text)) {
    return "tenancy";
  }
  return "general";
}

/** Held out of Matching help until they have a dispute they actually serve. */
export function parkedOffMatchingHelp(title: string, extra = ""): boolean {
  return /asylum support appeals|housing loss prevention|\bhlpas\b/i.test(`${title} ${extra}`);
}

export function isCitizensAdviceLead(title: string, url = ""): boolean {
  return /citizens advice/i.test(title) || /citizensadvice\.org\.uk|cas\.org\.uk/i.test(url);
}

function hayOf(title: string, extra = ""): string {
  return `${title} ${extra}`.toLowerCase();
}

function fitsLens(hay: string, lens: DisputeLens, text: string): boolean {
  if (/\b(asylum|refugee)\b/.test(hay) && lens !== "immigration") return false;
  if (lens === "neighbour") {
    if (
      /\b(leasehold|lease advice|\blease\b|justice for tenants|shelter|homeless|evict|possession|disrepair|deposit scheme|universal credit)\b/.test(
        hay,
      ) &&
      !NEIGHBOUR.test(hay)
    ) {
      return false;
    }
    return /neighbour|boundary|fence|nuisance|mediation|party wall|antisocial|right of way|driveway|access/.test(hay);
  }
  if (lens === "tenancy") {
    if (/\blease\b|leasehold/.test(hay) && !/lease|service charge|freeholder|ground rent/i.test(text)) return false;
    if (/neighbour|boundary|fence/.test(hay) && !TENANCY.test(text)) return false;
    return /shelter|tenant|landlord|rent|deposit|disrepair|evict|possession|housing|repairs|justice for tenants|flatmate/.test(
      hay,
    );
  }
  if (lens === "parking") {
    return /parking|pcn|popla|tribunal|adjudicator|penalty charge|motoring/.test(hay);
  }
  if (lens === "immigration") return /immig|asylum|visa|refugee|home office|oisc|settled|ilr/.test(hay);
  if (lens === "family") return /family|divorce|child|custody|parent|contact|mediation/.test(hay);
  if (lens === "employment") return /employ|work|tribunal|acas|dismissal|wages/.test(hay);
  if (lens === "debt") return /debt|money advice|insolvency|bankrupt|bailiff/.test(hay);
  if (lens === "consumer") return /consumer|refund|trader|ombudsman|faulty|goods|small claim/.test(hay);
  return !/\b(asylum|refugee)\b/.test(hay);
}

export function matchesDispute(
  row: { title: string; blurb?: string; url?: string; type?: string; sraId?: string },
  input: DisputeContext,
): boolean {
  const extra = `${row.blurb || ""} ${row.url || ""} ${row.type || ""}`;
  if (parkedOffMatchingHelp(row.title, extra)) return false;
  if (isCitizensAdviceLead(row.title, row.url)) return true;
  const lens = disputeLens(input);
  const hay = hayOf(row.title, extra);
  if (row.sraId || /sra-regulated|solicitor/i.test(row.type || "")) {
    return !(/\b(asylum|refugee)\b/.test(hay) && lens !== "immigration");
  }
  if (/directory/i.test(row.type || "") && !/\b(asylum|refugee)\b/.test(hay)) return true;
  return fitsLens(hay, lens, input.text || "");
}

function caPreference(title: string): number {
  if (/adviceline/i.test(title)) return 0;
  if (/^citizens advice\b/i.test(title.trim()) && title.trim().length < 48) return 1;
  return 2;
}

export function curateMatchingProviders<
  T extends { name: string; blurb: string; url?: string; positioning: string; sraId?: string },
>(rows: T[], input: DisputeContext): T[] {
  const kept = rows.filter((row) =>
    matchesDispute(
      {
        title: row.name,
        blurb: row.blurb,
        url: row.url,
        type: row.positioning,
        sraId: row.sraId,
      },
      input,
    ),
  );
  return withSingleCitizensAdviceLast(kept.map((row) => ({ ...row, title: row.name }))).map(
    ({ title: _title, ...row }) => row,
  );
}

export function withSingleCitizensAdviceLast<T extends { title: string; url?: string }>(rows: T[]): T[] {
  const advice = rows.filter((row) => isCitizensAdviceLead(row.title, row.url));
  const rest = rows.filter((row) => !isCitizensAdviceLead(row.title, row.url));
  if (!advice.length) return rest;
  const best = [...advice].sort((a, b) => caPreference(a.title) - caPreference(b.title) || a.title.length - b.title.length)[0];
  return best ? [...rest, best] : rest;
}

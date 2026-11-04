export type ProblemLanding = {
  slug: string;
  title: string;
  headline: string;
  summary: string;
  searchQuery: string;
  askHint: string;
  bullets: string[];
};

export const PROBLEM_LANDINGS: ProblemLanding[] = [
  {
    slug: "housing",
    title: "Housing & tenancy help",
    headline: "What housing problem do you need help resolving today?",
    summary:
      "Find free advice, legal aid, and solicitors for deposits, eviction risk, repairs, and landlord–tenant disputes — signposting only, not legal advice.",
    searchQuery: "housing tenancy eviction deposit",
    askHint: "Describe your housing situation",
    bullets: [
      "Deposit disputes and unfair deductions",
      "Eviction notices and possession proceedings",
      "Repairs, disrepair, and unsafe conditions",
      "Homelessness prevention and local authority duties",
    ],
  },
  {
    slug: "pcn",
    title: "Parking charge notices (PCNs)",
    headline: "Need to understand or challenge a parking charge?",
    summary:
      "Research appeal routes, deadlines, and who can help with private parking tickets and council PCNs — then shortlist suitable next steps.",
    searchQuery: "parking charge notice PCN appeal",
    askHint: "Describe your parking charge or PCN",
    bullets: [
      "Private parking tickets vs council PCNs",
      "Appeal deadlines and evidence checklists",
      "When free advice or a solicitor may help",
      "Signposting to POPLA, Traffic Penalty Tribunal, and guides",
    ],
  },
  {
    slug: "neighbour",
    title: "Neighbour disputes",
    headline: "Noise, boundaries, or nuisance next door?",
    summary:
      "Compare mediation, council routes, and legal support for neighbour disputes without jumping straight to paid advice.",
    searchQuery: "neighbour dispute noise boundary",
    askHint: "Describe the neighbour issue",
    bullets: [
      "Noise and antisocial behaviour",
      "Boundaries, fences, and rights of way",
      "Nuisance and mediation options",
      "When free advice is available first",
    ],
  },
  {
    slug: "family",
    title: "Family & separation",
    headline: "Separation, children, or finances?",
    summary:
      "Find mediation, legal aid where eligible, and specialist family support — prioritising free and funded help.",
    searchQuery: "family separation child arrangements",
    askHint: "Describe your family law concern",
    bullets: [
      "Separation and divorce signposting",
      "Child arrangements",
      "Financial disputes after separation",
      "Legal aid eligibility pointers",
    ],
  },
  {
    slug: "wills",
    title: "Wills & estates",
    headline: "Making a will or dealing with inheritance?",
    summary:
      "Locate guidance and professionals for wills, probate, and estate questions with clear cost banding where known.",
    searchQuery: "wills probate inheritance",
    askHint: "Describe your wills or estates question",
    bullets: [
      "Making or updating a will",
      "Probate and estate administration",
      "Inheritance disputes",
      "When a solicitor is needed vs free guidance",
    ],
  },
];

export function problemBySlug(slug: string): ProblemLanding | undefined {
  return PROBLEM_LANDINGS.find((p) => p.slug === slug);
}

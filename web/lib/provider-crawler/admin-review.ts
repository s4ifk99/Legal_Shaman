import { prisma } from "@/lib/db/prisma";
import type { PendingExtractedField } from "@/lib/provider-crawler/review-queue";
import {
  isGloballyApproved,
} from "@/lib/provider-enrichment/global-value-approvals";
import {
  shouldBlockRegulatoryEnrichment,
} from "@/lib/provider-enrichment/regulatory-url-filter";
import {
  canonicalSlugDedupKey,
  formatCanonicalSlugsForDisplay,
  normalizePracticeAreas,
  type NormalizedPracticeAreas,
} from "@/lib/provider-crawler/practice-area-normalizer";

const ENRICHMENT_TO_CRAWLER: Record<string, string> = {
  phone: "phone",
  email: "email",
  website: "website",
  capabilities: "capabilities",
  fundingCapabilities: "fundingCapabilities",
  urgencyCapabilities: "urgencyCapabilities",
  accessibilityCapabilities: "accessibilityCapabilities",
  languages: "languages",
  tribunalCapabilities: "tribunalCapabilities",
};

const FIELD_PRIORITY: Record<string, number> = {
  phone: 10,
  email: 20,
  website: 30,
  contact_page: 35,
  address: 40,
  opening_hours: 45,
  practice_areas: 50,
  capabilities: 55,
  tribunalCapabilities: 56,
  languages: 57,
  fundingCapabilities: 60,
  urgencyCapabilities: 65,
  accessibilityCapabilities: 70,
  testimonial_snippet: 80,
  review_aggregate_rating: 90,
  review_count: 91,
  trustpilot_profile_url: 92,
};

const CONTACT_FIELDS = new Set([
  "phone",
  "email",
  "website",
  "contact_page",
  "address",
  "opening_hours",
]);

const SECTION_DEFS: { key: string; label: string; fields: Set<string> }[] = [
  {
    key: "contact",
    label: "Contact",
    fields: new Set(["phone", "email", "website", "contact_page", "address", "opening_hours"]),
  },
  {
    key: "practice",
    label: "Practice areas & capabilities",
    fields: new Set(["practice_areas", "capabilities", "tribunalCapabilities", "languages"]),
  },
  {
    key: "funding",
    label: "Funding & access",
    fields: new Set(["fundingCapabilities", "urgencyCapabilities", "accessibilityCapabilities"]),
  },
  {
    key: "testimonials",
    label: "Testimonials",
    fields: new Set(["testimonial_snippet"]),
  },
  {
    key: "reviews",
    label: "Review signals",
    fields: new Set(["review_aggregate_rating", "review_count", "trustpilot_profile_url"]),
  },
];

export type ConfidenceTier = "high" | "medium" | "low";

export type ReviewItemFlags = {
  highConfidence: boolean;
  urgentContact: boolean;
  testimonial: boolean;
  lowConfidence: boolean;
  duplicateCandidate: boolean;
  needsManualReview: boolean;
};

export type AdminReviewItem = PendingExtractedField & {
  providerLabel: string;
  searchUrl: string;
  currentValue: string | null;
  isIdentical: boolean;
  isDuplicate: boolean;
  duplicateClusterId: string | null;
  confidencePct: number;
  confidenceTier: ConfidenceTier;
  displayOrder: number;
  flags: ReviewItemFlags;
  /** Present when fieldName is practice_areas (raw value retained on extractedValue). */
  practiceAreaNormalization?: NormalizedPracticeAreas;
};

export type AdminReviewSection = {
  key: string;
  label: string;
  items: AdminReviewItem[];
};

export type AdminProviderGroup = {
  entityId: string;
  entityType: string;
  label: string;
  searchUrl: string;
  itemCount: number;
  maxConfidencePct: number;
  sections: AdminReviewSection[];
};

export type DuplicateCluster = {
  id: string;
  fieldName: string;
  normalizedValue: string;
  displayValue: string;
  canonicalSlugs?: string[];
  providerCount: number;
  itemIds: string[];
  confidencePct: number;
};

export type CoverageMetrics = {
  websitePct: number;
  phonePct: number;
  emailPct: number;
  practiceAreaPct: number;
  completenessScore: number;
  totalProviders: number;
};

export type AdminReviewMetrics = {
  pendingTotal: number;
  reviewableCount: number;
  hiddenIdenticalCount: number;
  hiddenRegulatoryCount: number;
  hiddenGlobalCount: number;
  clusterCount: number;
  avgConfidencePct: number;
  autoApprovedPct: number;
  duplicatePct: number;
  approvalRatePct: number;
  newestExtraction: string | null;
  coverage: CoverageMetrics | null;
};

export type AdminReviewQueueEntry =
  | { kind: "cluster"; cluster: DuplicateCluster; displayOrder: number }
  | { kind: "item"; item: AdminReviewItem; displayOrder: number };

export type AdminReviewPayload = {
  providers: AdminProviderGroup[];
  duplicateClusters: DuplicateCluster[];
  standaloneItems: AdminReviewItem[];
  queueEntries: AdminReviewQueueEntry[];
  metrics: AdminReviewMetrics;
  allItemIds: string[];
};

export function confidenceTier(confidence: number): ConfidenceTier {
  const pct = confidence * 100;
  if (pct >= 90) return "high";
  if (pct >= 75) return "medium";
  return "low";
}

export function confidencePct(confidence: number): number {
  return Math.round(confidence * 100);
}

function practiceAreaSlugSet(value: string): Set<string> {
  return new Set(normalizePracticeAreas(value).canonicalSlugs);
}

export function normalizeForDedup(fieldName: string, value: string): string {
  const v = value.trim().toLowerCase();
  if (fieldName === "practice_areas") {
    return canonicalSlugDedupKey(normalizePracticeAreas(value).canonicalSlugs);
  }
  if (fieldName === "capabilities") {
    return v
      .split(/[,;|]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .sort()
      .join("|");
  }
  if (fieldName === "phone") return v.replace(/\D/g, "");
  if (fieldName === "email") return v;
  return v.replace(/\s+/g, " ");
}

function parseListValue(value: string): string[] {
  return value
    .split(/[,;|]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function listKey(items: string[]): string {
  return items
    .map((s) => s.toLowerCase())
    .sort()
    .join("|");
}

function isListField(fieldName: string): boolean {
  return (
    fieldName === "practice_areas" ||
    fieldName === "capabilities" ||
    fieldName === "fundingCapabilities" ||
    fieldName === "languages" ||
    fieldName === "tribunalCapabilities"
  );
}

export function valuesMatch(fieldName: string, proposed: string, approved: string): boolean {
  if (isListField(fieldName)) {
    return listKey(parseListValue(proposed)) === listKey(parseListValue(approved));
  }
  return normalizeForDedup(fieldName, proposed) === normalizeForDedup(fieldName, approved);
}

function aggregateCurrentValue(fieldName: string, approvedValues: string[]): string | null {
  if (approvedValues.length === 0) return null;
  if (fieldName === "practice_areas") {
    const merged = new Set<string>();
    for (const v of approvedValues) {
      for (const slug of normalizePracticeAreas(v).canonicalSlugs) merged.add(slug);
    }
    if (merged.size === 0) return null;
    return formatCanonicalSlugsForDisplay([...merged].sort((a, b) => a.localeCompare(b)));
  }
  if (isListField(fieldName)) {
    const merged = new Set<string>();
    for (const v of approvedValues) {
      for (const part of parseListValue(v)) merged.add(part);
    }
    return [...merged].sort((a, b) => a.localeCompare(b)).join(", ");
  }
  return approvedValues[0] ?? null;
}

export function isIdenticalToApproved(
  fieldName: string,
  proposed: string,
  approvedValues: string[],
): boolean {
  if (approvedValues.length === 0) return false;
  if (fieldName === "practice_areas") {
    const proposedSet = practiceAreaSlugSet(proposed);
    if (proposedSet.size === 0) return false;
    for (const a of approvedValues) {
      const approvedSet = practiceAreaSlugSet(a);
      if (proposedSet.size === approvedSet.size) {
        let same = true;
        for (const slug of proposedSet) {
          if (!approvedSet.has(slug)) {
            same = false;
            break;
          }
        }
        if (same) return true;
      }
    }
    return false;
  }
  if (isListField(fieldName)) {
    const proposedSet = listKey(parseListValue(proposed));
    for (const a of approvedValues) {
      if (listKey(parseListValue(a)) === proposedSet) return true;
      const approvedParts = new Set(parseListValue(a).map((x) => x.toLowerCase()));
      const proposedParts = parseListValue(proposed);
      if (
        proposedParts.length > 0 &&
        proposedParts.every((p) => approvedParts.has(p.toLowerCase())) &&
        proposedParts.length === approvedParts.size
      ) {
        return true;
      }
    }
    return false;
  }
  return approvedValues.some((a) => valuesMatch(fieldName, proposed, a));
}

async function resolveEntityLabels(
  entityIds: string[],
): Promise<Map<string, { label: string; searchUrl: string }>> {
  const out = new Map<string, { label: string; searchUrl: string }>();
  const firmIds: string[] = [];
  const lawyerIds: string[] = [];

  for (const id of entityIds) {
    if (id.startsWith("firm:")) firmIds.push(id.slice(5));
    else if (id.startsWith("lawyer:")) lawyerIds.push(id.slice(7));
  }

  const [firms, lawyers] = await Promise.all([
    firmIds.length
      ? prisma.firm.findMany({ where: { id: { in: firmIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
    lawyerIds.length
      ? prisma.lawyer.findMany({ where: { id: { in: lawyerIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
  ]);

  for (const f of firms) {
    const entityId = `firm:${f.id}`;
    out.set(entityId, {
      label: f.name,
      searchUrl: `/search?q=${encodeURIComponent(f.name)}`,
    });
  }
  for (const l of lawyers) {
    const entityId = `lawyer:${l.id}`;
    out.set(entityId, {
      label: l.name,
      searchUrl: `/lawyers/${l.id}`,
    });
  }

  for (const id of entityIds) {
    if (out.has(id)) continue;
    const short = id.includes(":") ? id.split(":").slice(1).join(":") : id;
    const label = short.length > 48 ? `${short.slice(0, 45)}…` : short;
    out.set(id, {
      label,
      searchUrl: `/search?q=${encodeURIComponent(label)}`,
    });
  }

  return out;
}

async function loadApprovedValuesByEntity(
  entityIds: string[],
): Promise<Map<string, Map<string, string[]>>> {
  const map = new Map<string, Map<string, string[]>>();
  if (entityIds.length === 0) return map;

  const add = (entityId: string, fieldName: string, value: string) => {
    let fields = map.get(entityId);
    if (!fields) {
      fields = new Map();
      map.set(entityId, fields);
    }
    const list = fields.get(fieldName) ?? [];
    if (!list.includes(value)) list.push(value);
    fields.set(fieldName, list);
  };

  const [enrichments, extracted] = await Promise.all([
    prisma.providerEnrichment.findMany({
      where: {
        entityId: { in: entityIds },
        status: { in: ["approved", "auto_approved"] },
      },
      select: { entityId: true, fieldName: true, extractedValue: true },
    }),
    prisma.providerExtractedField.findMany({
      where: {
        entityId: { in: entityIds },
        status: { in: ["approved", "auto_approved"] },
      },
      select: { entityId: true, fieldName: true, extractedValue: true },
    }),
  ]);

  for (const row of enrichments) {
    const crawlerField = ENRICHMENT_TO_CRAWLER[row.fieldName] ?? row.fieldName;
    add(row.entityId, crawlerField, row.extractedValue);
  }
  for (const row of extracted) {
    add(row.entityId, row.fieldName, row.extractedValue);
  }

  return map;
}

export async function computeCoverageMetrics(): Promise<CoverageMetrics | null> {
  try {
    const totalProviders = await prisma.sraOrganisation.count();
    if (totalProviders === 0) return null;

    const approvedStatuses = ["approved", "auto_approved"] as const;
    const [phoneRows, emailRows, websiteRows, practiceRows] = await Promise.all([
      prisma.providerEnrichment.findMany({
        where: { fieldName: "phone", status: { in: [...approvedStatuses] } },
        select: { entityId: true },
        distinct: ["entityId"],
      }),
      prisma.providerEnrichment.findMany({
        where: { fieldName: "email", status: { in: [...approvedStatuses] } },
        select: { entityId: true },
        distinct: ["entityId"],
      }),
      prisma.providerEnrichment.findMany({
        where: { fieldName: "website", status: { in: [...approvedStatuses] } },
        select: { entityId: true },
        distinct: ["entityId"],
      }),
      prisma.providerEnrichment.findMany({
        where: { fieldName: "practiceAreaSlugs", status: { in: [...approvedStatuses] } },
        select: { entityId: true },
        distinct: ["entityId"],
      }),
    ]);

    const pct = (n: number) => Math.round((n / totalProviders) * 100);
    const websitePct = pct(websiteRows.length);
    const phonePct = pct(phoneRows.length);
    const emailPct = pct(emailRows.length);
    const practiceAreaPct = pct(practiceRows.length);
    const completenessScore = Math.round(
      (websitePct + phonePct + emailPct + practiceAreaPct) / 4,
    );

    return {
      websitePct,
      phonePct,
      emailPct,
      practiceAreaPct,
      completenessScore,
      totalProviders,
    };
  } catch {
    return null;
  }
}

export async function computeAdminReviewMetrics(): Promise<AdminReviewMetrics> {
  try {
    const [pendingTotal, statusGroups, newest, pendingRows, coverage] = await Promise.all([
      prisma.providerExtractedField.count({ where: { status: "pending_review" } }),
      prisma.providerExtractedField.groupBy({
        by: ["status"],
        _count: { _all: true },
      }),
      prisma.providerExtractedField.findFirst({
        where: { status: "pending_review" },
        orderBy: { extractedAt: "desc" },
        select: { extractedAt: true },
      }),
      prisma.providerExtractedField.findMany({
        where: { status: "pending_review" },
        select: { confidence: true },
      }),
      computeCoverageMetrics(),
    ]);

    const counts: Record<string, number> = {};
    for (const g of statusGroups) counts[g.status] = g._count._all;

    const auto = counts.auto_approved ?? 0;
    const approved = counts.approved ?? 0;
    const rejected = counts.rejected ?? 0;
    const decided = auto + approved + rejected;
    const autoApprovedPct = decided > 0 ? Math.round((auto / decided) * 100) : 0;
    const approvalRatePct =
      approved + rejected > 0 ? Math.round((approved / (approved + rejected)) * 100) : 0;

    const avgConfidencePct =
      pendingRows.length > 0
        ? Math.round(
            (pendingRows.reduce((s, r) => s + r.confidence, 0) / pendingRows.length) * 100,
          )
        : 0;

    return {
      pendingTotal,
      reviewableCount: 0,
      hiddenIdenticalCount: 0,
      hiddenRegulatoryCount: 0,
      hiddenGlobalCount: 0,
      clusterCount: 0,
      avgConfidencePct,
      autoApprovedPct,
      duplicatePct: 0,
      approvalRatePct,
      newestExtraction: newest?.extractedAt.toISOString() ?? null,
      coverage,
    };
  } catch {
    return {
      pendingTotal: 0,
      reviewableCount: 0,
      hiddenIdenticalCount: 0,
      hiddenRegulatoryCount: 0,
      hiddenGlobalCount: 0,
      clusterCount: 0,
      avgConfidencePct: 0,
      autoApprovedPct: 0,
      duplicatePct: 0,
      approvalRatePct: 0,
      newestExtraction: null,
      coverage: null,
    };
  }
}

export async function enrichAdminReviewPayload(
  pending: PendingExtractedField[],
): Promise<AdminReviewPayload> {
  const metricsBase = await computeAdminReviewMetrics();
  if (pending.length === 0) {
    return {
      providers: [],
      duplicateClusters: [],
      standaloneItems: [],
      queueEntries: [],
      metrics: {
        ...metricsBase,
        reviewableCount: 0,
        hiddenIdenticalCount: 0,
        hiddenRegulatoryCount: 0,
        hiddenGlobalCount: 0,
        clusterCount: 0,
        duplicatePct: 0,
      },
      allItemIds: [],
    };
  }

  const globalChecks = await Promise.all(
    pending.map(async (row) => ({
      id: row.id,
      global: await isGloballyApproved(row.fieldName, row.extractedValue),
    })),
  );
  const globalApprovedIds = new Set(
    globalChecks.filter((g) => g.global).map((g) => g.id),
  );

  const reviewablePending = pending.filter((row) => {
    if (globalApprovedIds.has(row.id)) return false;
    const reg = shouldBlockRegulatoryEnrichment(
      row.fieldName,
      row.extractedValue,
      row.sourceUrl,
    );
    return !reg.block;
  });

  const hiddenGlobal = globalApprovedIds.size;
  let hiddenRegulatory = 0;
  for (const row of pending) {
    if (globalApprovedIds.has(row.id)) continue;
    const reg = shouldBlockRegulatoryEnrichment(
      row.fieldName,
      row.extractedValue,
      row.sourceUrl,
    );
    if (reg.block) hiddenRegulatory++;
  }

  const entityIds = [...new Set(reviewablePending.map((p) => p.entityId))];
  const [labels, approvedByEntity] = await Promise.all([
    resolveEntityLabels(entityIds),
    loadApprovedValuesByEntity(entityIds),
  ]);

  const clusterMap = new Map<
    string,
    { ids: string[]; displayValue: string; fieldName: string; canonicalSlugs?: string[] }
  >();
  for (const row of reviewablePending) {
    const key = `${row.fieldName}::${normalizeForDedup(row.fieldName, row.extractedValue)}`;
    const paNorm =
      row.fieldName === "practice_areas" ? normalizePracticeAreas(row.extractedValue) : null;
    const displayValue = paNorm
      ? formatCanonicalSlugsForDisplay(paNorm.canonicalSlugs)
      : row.extractedValue;
    const cur = clusterMap.get(key);
    if (cur) cur.ids.push(row.id);
    else
      clusterMap.set(key, {
        ids: [row.id],
        displayValue,
        fieldName: row.fieldName,
        canonicalSlugs: paNorm?.canonicalSlugs,
      });
  }

  const duplicateClusterIdByItem = new Map<string, string>();
  const duplicateClusters: DuplicateCluster[] = [];
  for (const [key, cluster] of clusterMap) {
    if (cluster.ids.length < 2) continue;
    const id = `dup-${key.slice(0, 80)}`;
    const rows = reviewablePending.filter((p) => cluster.ids.includes(p.id));
    const avgConf =
      rows.reduce((s, r) => s + r.confidence, 0) / Math.max(1, rows.length);
    duplicateClusters.push({
      id,
      fieldName: cluster.fieldName,
      normalizedValue: key.split("::").slice(1).join("::"),
      displayValue: cluster.displayValue,
      canonicalSlugs: cluster.canonicalSlugs,
      providerCount: new Set(rows.map((r) => r.entityId)).size,
      itemIds: cluster.ids,
      confidencePct: confidencePct(avgConf),
    });
    for (const itemId of cluster.ids) duplicateClusterIdByItem.set(itemId, id);
  }

  duplicateClusters.sort((a, b) => b.providerCount - a.providerCount);

  const enriched: AdminReviewItem[] = [];
  let hiddenIdentical = 0;

  for (const row of reviewablePending) {
    const approved =
      approvedByEntity.get(row.entityId)?.get(row.fieldName) ?? [];
    const identical = isIdenticalToApproved(row.fieldName, row.extractedValue, approved);
    if (identical) {
      hiddenIdentical++;
      continue;
    }

    const meta = labels.get(row.entityId) ?? {
      label: row.entityId,
      searchUrl: `/search?q=${encodeURIComponent(row.entityId)}`,
    };
    const pct = confidencePct(row.confidence);
    const tier = confidenceTier(row.confidence);
    const dupId = duplicateClusterIdByItem.get(row.id) ?? null;
    const isDup = dupId !== null;

    const flags: ReviewItemFlags = {
      highConfidence: pct >= 90,
      urgentContact: CONTACT_FIELDS.has(row.fieldName),
      testimonial: row.reviewCategory === "testimonial",
      lowConfidence: pct < 75,
      duplicateCandidate: isDup,
      needsManualReview: pct < 75 || isDup || tier === "low",
    };

    const practiceAreaNormalization =
      row.fieldName === "practice_areas"
        ? normalizePracticeAreas(row.extractedValue)
        : undefined;

    enriched.push({
      ...row,
      providerLabel: meta.label,
      searchUrl: meta.searchUrl,
      currentValue: aggregateCurrentValue(row.fieldName, approved),
      isIdentical: false,
      isDuplicate: isDup,
      duplicateClusterId: dupId,
      confidencePct: pct,
      confidenceTier: tier,
      displayOrder: FIELD_PRIORITY[row.fieldName] ?? 99,
      flags,
      practiceAreaNormalization,
    });
  }

  enriched.sort((a, b) => a.displayOrder - b.displayOrder || b.confidence - a.confidence);

  const byEntity = new Map<string, AdminReviewItem[]>();
  for (const item of enriched) {
    const list = byEntity.get(item.entityId) ?? [];
    list.push(item);
    byEntity.set(item.entityId, list);
  }

  const providers: AdminProviderGroup[] = [];
  for (const [entityId, items] of byEntity) {
    const meta = labels.get(entityId) ?? {
      label: entityId,
      searchUrl: `/search?q=${encodeURIComponent(entityId)}`,
    };
    const sectionBuckets = new Map<string, AdminReviewItem[]>();
    const misc: AdminReviewItem[] = [];

    for (const item of items) {
      const def = SECTION_DEFS.find((s) => s.fields.has(item.fieldName));
      if (def) {
        const list = sectionBuckets.get(def.key) ?? [];
        list.push(item);
        sectionBuckets.set(def.key, list);
      } else {
        misc.push(item);
      }
    }

    const sections: AdminReviewSection[] = [];
    for (const def of SECTION_DEFS) {
      const sectionItems = sectionBuckets.get(def.key);
      if (sectionItems?.length) {
        sections.push({ key: def.key, label: def.label, items: sectionItems });
      }
    }
    if (misc.length) {
      sections.push({ key: "other", label: "Other", items: misc });
    }

    providers.push({
      entityId,
      entityType: items[0]?.entityType ?? "unknown",
      label: meta.label,
      searchUrl: meta.searchUrl,
      itemCount: items.length,
      maxConfidencePct: Math.max(...items.map((i) => i.confidencePct)),
      sections,
    });
  }

  providers.sort((a, b) => b.itemCount - a.itemCount || b.maxConfidencePct - a.maxConfidencePct);

  const standaloneItems = enriched.filter((i) => !i.isDuplicate);
  const clusteredItemIds = new Set(
    duplicateClusters.flatMap((c) => c.itemIds),
  );

  const providersWithoutDupes: AdminProviderGroup[] = providers
    .map((p) => {
      const sections = p.sections
        .map((s) => ({
          ...s,
          items: s.items.filter((i) => !clusteredItemIds.has(i.id)),
        }))
        .filter((s) => s.items.length > 0);
      if (sections.length === 0) return null;
      const items = sections.flatMap((s) => s.items);
      return {
        ...p,
        sections,
        itemCount: items.length,
        maxConfidencePct: Math.max(...items.map((i) => i.confidencePct)),
      };
    })
    .filter((p): p is AdminProviderGroup => p !== null);

  const queueEntries: AdminReviewQueueEntry[] = [];
  for (const cluster of duplicateClusters) {
    queueEntries.push({
      kind: "cluster",
      cluster,
      displayOrder: FIELD_PRIORITY[cluster.fieldName] ?? 99,
    });
  }
  for (const item of standaloneItems) {
    queueEntries.push({
      kind: "item",
      item,
      displayOrder: item.displayOrder,
    });
  }
  queueEntries.sort(
    (a, b) =>
      a.displayOrder - b.displayOrder ||
      (a.kind === "cluster" && b.kind === "cluster"
        ? b.cluster.providerCount - a.cluster.providerCount
        : 0),
  );

  const duplicateItemCount = enriched.filter((i) => i.isDuplicate).length;
  const duplicatePct =
    enriched.length > 0 ? Math.round((duplicateItemCount / enriched.length) * 100) : 0;

  return {
    providers: providersWithoutDupes,
    duplicateClusters,
    standaloneItems,
    queueEntries,
    metrics: {
      ...metricsBase,
      reviewableCount: queueEntries.length,
      hiddenIdenticalCount: hiddenIdentical,
      hiddenRegulatoryCount: hiddenRegulatory,
      hiddenGlobalCount: hiddenGlobal,
      clusterCount: duplicateClusters.length,
      duplicatePct,
    },
    allItemIds: enriched.map((i) => i.id),
  };
}

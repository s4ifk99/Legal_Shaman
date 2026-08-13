import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

export const CRM_STAGES = ["cold", "warm", "sold"] as const;
export type CrmStage = (typeof CRM_STAGES)[number];

export function isCrmStage(value: string): value is CrmStage {
  return (CRM_STAGES as readonly string[]).includes(value);
}

export type CrmLeadFields = {
  stage: CrmStage;
  notes: string;
  leadContactName: string;
  leadContactRole: string;
  leadContactEmail: string;
  leadContactPhone: string;
  salesChampionName: string;
  salesChampionRole: string;
  salesChampionEmail: string;
  salesChampionPhone: string;
  salesChampionNotes: string;
  lastContactedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CrmProspectRow = {
  sraId: string;
  name: string;
  website: string;
  email: string;
  phone: string;
  city: string;
  county: string;
  postcode: string;
  sraProfileUrl: string;
  inPipeline: boolean;
  stage: CrmStage | null;
  lead: CrmLeadFields | null;
};

function firmDisplayName(row: {
  displayName: string;
  businessName: string;
  organisationName: string;
  firmName: string;
  tradingName: string;
}): string {
  return (
    row.displayName ||
    row.businessName ||
    row.organisationName ||
    row.firmName ||
    row.tradingName ||
    "Unnamed firm"
  );
}

function mapLead(lead: {
  stage: string;
  notes: string;
  leadContactName: string;
  leadContactRole: string;
  leadContactEmail: string;
  leadContactPhone: string;
  salesChampionName: string;
  salesChampionRole: string;
  salesChampionEmail: string;
  salesChampionPhone: string;
  salesChampionNotes: string;
  lastContactedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): CrmLeadFields {
  return {
    stage: isCrmStage(lead.stage) ? lead.stage : "cold",
    notes: lead.notes,
    leadContactName: lead.leadContactName,
    leadContactRole: lead.leadContactRole,
    leadContactEmail: lead.leadContactEmail,
    leadContactPhone: lead.leadContactPhone,
    salesChampionName: lead.salesChampionName,
    salesChampionRole: lead.salesChampionRole,
    salesChampionEmail: lead.salesChampionEmail,
    salesChampionPhone: lead.salesChampionPhone,
    salesChampionNotes: lead.salesChampionNotes,
    lastContactedAt: lead.lastContactedAt?.toISOString() ?? null,
    createdAt: lead.createdAt.toISOString(),
    updatedAt: lead.updatedAt.toISOString(),
  };
}

export async function getCrmStageCounts() {
  const groups = await prisma.crmLead.groupBy({
    by: ["stage"],
    _count: { _all: true },
  });
  const counts: Record<CrmStage, number> = { cold: 0, warm: 0, sold: 0 };
  for (const g of groups) {
    if (isCrmStage(g.stage)) counts[g.stage] = g._count._all;
  }
  return counts;
}

export async function listCrmProspects(options: {
  q?: string;
  stage?: CrmStage | "pipeline" | "all";
  requirePhone?: boolean;
  requireEmail?: boolean;
  requireWebsite?: boolean;
  page?: number;
  pageSize?: number;
}): Promise<{ rows: CrmProspectRow[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(100, Math.max(10, options.pageSize ?? 50));
  const q = options.q?.trim() ?? "";

  const where: Prisma.SraOrganisationWhereInput = {};
  if (q) {
    where.OR = [
      { displayName: { contains: q, mode: "insensitive" } },
      { businessName: { contains: q, mode: "insensitive" } },
      { organisationName: { contains: q, mode: "insensitive" } },
      { firmName: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
      { phone: { contains: q, mode: "insensitive" } },
      { city: { contains: q, mode: "insensitive" } },
      { sraId: { contains: q, mode: "insensitive" } },
    ];
  }
  if (options.requirePhone) where.phone = { not: "" };
  if (options.requireEmail) where.email = { not: "" };
  if (options.requireWebsite) where.website = { not: "" };

  // Pipeline-only: restrict to SRA IDs that already have a CRM lead (optionally by stage)
  let pipelineSraIds: string[] | null = null;
  if (options.stage && options.stage !== "all") {
    const leadWhere =
      options.stage === "pipeline" ? {} : { stage: options.stage };
    const leads = await prisma.crmLead.findMany({
      where: leadWhere,
      select: { sraId: true },
    });
    pipelineSraIds = leads.map((l) => l.sraId);
    if (pipelineSraIds.length === 0) {
      return { rows: [], total: 0, page, pageSize };
    }
    where.sraId = { in: pipelineSraIds };
  }

  const [total, orgs] = await Promise.all([
    prisma.sraOrganisation.count({ where }),
    prisma.sraOrganisation.findMany({
      where,
      orderBy: [{ displayName: "asc" }, { businessName: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        sraId: true,
        displayName: true,
        businessName: true,
        organisationName: true,
        firmName: true,
        tradingName: true,
        website: true,
        email: true,
        phone: true,
        city: true,
        county: true,
        postcode: true,
        sraProfileUrl: true,
      },
    }),
  ]);

  const sraIds = orgs.map((o) => o.sraId);
  const leads = sraIds.length
    ? await prisma.crmLead.findMany({ where: { sraId: { in: sraIds } } })
    : [];
  const leadBySra = new Map(leads.map((l) => [l.sraId, l]));

  const rows: CrmProspectRow[] = orgs.map((org) => {
    const lead = leadBySra.get(org.sraId);
    return {
      sraId: org.sraId,
      name: firmDisplayName(org),
      website: org.website,
      email: org.email,
      phone: org.phone,
      city: org.city,
      county: org.county,
      postcode: org.postcode,
      sraProfileUrl: org.sraProfileUrl,
      inPipeline: Boolean(lead),
      stage: lead && isCrmStage(lead.stage) ? lead.stage : null,
      lead: lead ? mapLead(lead) : null,
    };
  });

  return { rows, total, page, pageSize };
}

export async function listCrmPipelineBoard(): Promise<Record<CrmStage, CrmProspectRow[]>> {
  const leads = await prisma.crmLead.findMany({
    orderBy: { updatedAt: "desc" },
  });
  const sraIds = leads.map((l) => l.sraId);
  const orgs = sraIds.length
    ? await prisma.sraOrganisation.findMany({
        where: { sraId: { in: sraIds } },
        select: {
          sraId: true,
          displayName: true,
          businessName: true,
          organisationName: true,
          firmName: true,
          tradingName: true,
          website: true,
          email: true,
          phone: true,
          city: true,
          county: true,
          postcode: true,
          sraProfileUrl: true,
        },
      })
    : [];
  const orgBySra = new Map(orgs.map((o) => [o.sraId, o]));

  const board: Record<CrmStage, CrmProspectRow[]> = { cold: [], warm: [], sold: [] };
  for (const lead of leads) {
    if (!isCrmStage(lead.stage)) continue;
    const org = orgBySra.get(lead.sraId);
    if (!org) continue;
    board[lead.stage].push({
      sraId: org.sraId,
      name: firmDisplayName(org),
      website: org.website,
      email: org.email,
      phone: org.phone,
      city: org.city,
      county: org.county,
      postcode: org.postcode,
      sraProfileUrl: org.sraProfileUrl,
      inPipeline: true,
      stage: lead.stage,
      lead: mapLead(lead),
    });
  }
  return board;
}

export type UpsertCrmLeadInput = {
  sraId: string;
  stage?: CrmStage;
  notes?: string;
  leadContactName?: string;
  leadContactRole?: string;
  leadContactEmail?: string;
  leadContactPhone?: string;
  salesChampionName?: string;
  salesChampionRole?: string;
  salesChampionEmail?: string;
  salesChampionPhone?: string;
  salesChampionNotes?: string;
  markContacted?: boolean;
};

export async function upsertCrmLead(input: UpsertCrmLeadInput) {
  const org = await prisma.sraOrganisation.findUnique({
    where: { sraId: input.sraId },
    select: { sraId: true },
  });
  if (!org) {
    throw new Error(`SRA firm not found: ${input.sraId}`);
  }

  const data = {
    ...(input.stage ? { stage: input.stage } : {}),
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
    ...(input.leadContactName !== undefined ? { leadContactName: input.leadContactName } : {}),
    ...(input.leadContactRole !== undefined ? { leadContactRole: input.leadContactRole } : {}),
    ...(input.leadContactEmail !== undefined ? { leadContactEmail: input.leadContactEmail } : {}),
    ...(input.leadContactPhone !== undefined ? { leadContactPhone: input.leadContactPhone } : {}),
    ...(input.salesChampionName !== undefined
      ? { salesChampionName: input.salesChampionName }
      : {}),
    ...(input.salesChampionRole !== undefined
      ? { salesChampionRole: input.salesChampionRole }
      : {}),
    ...(input.salesChampionEmail !== undefined
      ? { salesChampionEmail: input.salesChampionEmail }
      : {}),
    ...(input.salesChampionPhone !== undefined
      ? { salesChampionPhone: input.salesChampionPhone }
      : {}),
    ...(input.salesChampionNotes !== undefined
      ? { salesChampionNotes: input.salesChampionNotes }
      : {}),
    ...(input.markContacted ? { lastContactedAt: new Date() } : {}),
  };

  const lead = await prisma.crmLead.upsert({
    where: { sraId: input.sraId },
    create: {
      sraId: input.sraId,
      stage: input.stage ?? "cold",
      notes: input.notes ?? "",
      leadContactName: input.leadContactName ?? "",
      leadContactRole: input.leadContactRole ?? "",
      leadContactEmail: input.leadContactEmail ?? "",
      leadContactPhone: input.leadContactPhone ?? "",
      salesChampionName: input.salesChampionName ?? "",
      salesChampionRole: input.salesChampionRole ?? "",
      salesChampionEmail: input.salesChampionEmail ?? "",
      salesChampionPhone: input.salesChampionPhone ?? "",
      salesChampionNotes: input.salesChampionNotes ?? "",
      lastContactedAt: input.markContacted ? new Date() : null,
    },
    update: data,
  });

  return mapLead(lead);
}

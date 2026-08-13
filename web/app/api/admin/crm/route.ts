import { requireAdminApiRequest } from "@/lib/admin/auth";
import { adminJsonResponse } from "@/lib/admin/api-response";
import {
  getCrmStageCounts,
  isCrmStage,
  listCrmPipelineBoard,
  listCrmProspects,
  upsertCrmLead,
  type CrmStage,
} from "@/lib/admin/crm";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = await requireAdminApiRequest(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const view = url.searchParams.get("view") || "prospects";

  try {
    if (view === "pipeline") {
      const [board, stageCounts] = await Promise.all([
        listCrmPipelineBoard(),
        getCrmStageCounts(),
      ]);
      return adminJsonResponse({ view: "pipeline", board, stageCounts });
    }

    const q = url.searchParams.get("q") || undefined;
    const stageParam = url.searchParams.get("stage") || "all";
    const stage =
      stageParam === "all" || stageParam === "pipeline" || isCrmStage(stageParam)
        ? (stageParam as CrmStage | "pipeline" | "all")
        : "all";
    const page = Number(url.searchParams.get("page") || "1");
    const pageSize = Number(url.searchParams.get("pageSize") || "50");
    const requirePhone = url.searchParams.get("requirePhone") === "1";
    const requireEmail = url.searchParams.get("requireEmail") === "1";
    const requireWebsite = url.searchParams.get("requireWebsite") === "1";

    const [result, stageCounts] = await Promise.all([
      listCrmProspects({
        q,
        stage,
        page,
        pageSize,
        requirePhone,
        requireEmail,
        requireWebsite,
      }),
      getCrmStageCounts(),
    ]);

    return adminJsonResponse({ view: "prospects", ...result, stageCounts });
  } catch (err) {
    return adminJsonResponse(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  const denied = await requireAdminApiRequest(req);
  if (denied) return denied;

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const sraId = String(body.sraId || "").trim();
    if (!sraId) {
      return adminJsonResponse({ error: "sraId is required" }, { status: 400 });
    }

    const stageRaw = body.stage != null ? String(body.stage) : undefined;
    if (stageRaw && !isCrmStage(stageRaw)) {
      return adminJsonResponse(
        { error: "stage must be cold, warm, or sold" },
        { status: 400 },
      );
    }

    const lead = await upsertCrmLead({
      sraId,
      stage: stageRaw as CrmStage | undefined,
      notes: body.notes != null ? String(body.notes) : undefined,
      leadContactName:
        body.leadContactName != null ? String(body.leadContactName) : undefined,
      leadContactRole:
        body.leadContactRole != null ? String(body.leadContactRole) : undefined,
      leadContactEmail:
        body.leadContactEmail != null ? String(body.leadContactEmail) : undefined,
      leadContactPhone:
        body.leadContactPhone != null ? String(body.leadContactPhone) : undefined,
      salesChampionName:
        body.salesChampionName != null ? String(body.salesChampionName) : undefined,
      salesChampionRole:
        body.salesChampionRole != null ? String(body.salesChampionRole) : undefined,
      salesChampionEmail:
        body.salesChampionEmail != null ? String(body.salesChampionEmail) : undefined,
      salesChampionPhone:
        body.salesChampionPhone != null ? String(body.salesChampionPhone) : undefined,
      salesChampionNotes:
        body.salesChampionNotes != null ? String(body.salesChampionNotes) : undefined,
      markContacted: body.markContacted === true,
    });

    return adminJsonResponse({ ok: true, lead });
  } catch (err) {
    return adminJsonResponse(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

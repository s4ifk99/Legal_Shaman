import { sraNumberFromRaw } from "@/lib/search/sra-document";

const DEFAULT_SRA_URL =
  process.env.SRA_ORGANISATIONS_URL?.trim() ||
  "https://sra-prod-apim.azure-api.net/datashare/api/V1/organisation/GetAll";

function extractRows(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  if (!body || typeof body !== "object") return [];
  const o = body as Record<string, unknown>;
  for (const k of ["value", "items", "data", "organisations", "Organisations", "results", "Results"]) {
    const v = o[k];
    if (Array.isArray(v)) return v;
  }
  return [];
}

/**
 * Fetch all organisations from SRA Data Share GetAll (gzip, retries).
 */
export async function fetchAllOrganisationsFromApi(
  key: string,
  startUrl = DEFAULT_SRA_URL,
): Promise<Record<string, unknown>[]> {
  const headers = {
    "Ocp-Apim-Subscription-Key": key,
    "Cache-Control": "no-cache",
    "Accept-Encoding": "gzip",
  };

  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(startUrl, { headers });
      if (!res.ok) {
        throw new Error(`SRA HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`);
      }
      const body: unknown = await res.json();
      const rows = extractRows(body).filter(
        (r): r is Record<string, unknown> => Boolean(r) && typeof r === "object" && !Array.isArray(r),
      );
      if (rows.length === 0) {
        throw new Error("SRA GetAll returned 0 organisations");
      }
      return rows;
    } catch (err) {
      lastError = err;
      if (attempt < 3) {
        const delayMs = attempt * 5000;
        console.warn(
          `[sra:fetch] GetAll attempt ${attempt} failed (${err instanceof Error ? err.message : err}); retrying in ${delayMs}ms…`,
        );
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** Extract public SRA numbers from raw GetAll rows. */
export function activeSraIdsFromGetAllRows(rows: Record<string, unknown>[]): string[] {
  return [...new Set(rows.map((r) => sraNumberFromRaw(r)).filter(Boolean))];
}

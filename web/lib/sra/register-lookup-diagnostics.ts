import type { SraRegisterLookupDiagnostics } from "@/lib/sra/register-lookup";

export function formatLookupDiagnostics(diag: SraRegisterLookupDiagnostics): string {
  const lines: string[] = [];
  lines.push(`--- SRA lookup ${diag.sraId} ---`);
  lines.push(`finalOutcome: ${diag.finalOutcome}`);
  if (diag.result?.displayName) {
    lines.push(`displayName: ${diag.result.displayName}`);
  }
  if (diag.result?.rejectReason) {
    lines.push(`rejectReason: ${diag.result.rejectReason}`);
  }

  for (const [i, a] of diag.attempts.entries()) {
    lines.push("");
    lines.push(`[attempt ${i + 1}] ${a.channel} ${a.outcome}`);
    lines.push(`  url: ${a.url}`);
    if (a.httpStatus != null) lines.push(`  httpStatus: ${a.httpStatus}`);
    if (a.contentType) lines.push(`  contentType: ${a.contentType}`);
    if (a.parseNote) lines.push(`  parseNote: ${a.parseNote}`);
    if (a.rejectReason) lines.push(`  rejectReason: ${a.rejectReason}`);
    if (a.error) lines.push(`  error: ${a.error}`);
    if (a.parsedFields && Object.keys(a.parsedFields).length) {
      lines.push(`  parsedFields: ${JSON.stringify(a.parsedFields)}`);
    }
    if (a.bodyPreview) {
      lines.push(`  bodyPreview: ${JSON.stringify(a.bodyPreview)}`);
    }
  }

  return lines.join("\n");
}

export function printLookupDiagnostics(diag: SraRegisterLookupDiagnostics): void {
  console.info(formatLookupDiagnostics(diag));
}

export function diagnosticsToJson(diag: SraRegisterLookupDiagnostics): Record<string, unknown> {
  return {
    sraId: diag.sraId,
    finalOutcome: diag.finalOutcome,
    result: diag.result,
    attempts: diag.attempts,
  };
}

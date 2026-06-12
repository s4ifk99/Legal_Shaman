const warnedSources = new Set<string>();

export function formatCoverageDatasourceError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const first = error.message.split("\n")[0]?.trim();
  return first || error.message.trim() || "(empty)";
}

/** One structured warning per source per process (no Prisma stack spam). */
export function warnCoverageDatasourceUnavailable(source: string, error: unknown): void {
  if (warnedSources.has(source)) return;
  warnedSources.add(source);
  console.warn(
    JSON.stringify({
      event: "coverage_report_datasource_unavailable",
      source,
      error: formatCoverageDatasourceError(error),
    }),
  );
}

export function resetCoverageDatasourceWarnDedupe(): void {
  warnedSources.clear();
}

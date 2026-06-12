import type { PrismaClient } from "@prisma/client";
import { closeLawSocietyBrowser } from "@/lib/sra/law-society-playwright";

export type ActiveHandleSnapshot = {
  handleCount: number;
  requestCount: number;
  handles: { index: number; type: string; detail?: string }[];
  requests: { index: number; type: string; detail?: string }[];
};

export type RecoveryShutdownOptions = {
  prisma?: PrismaClient;
  closeLawSociety?: boolean;
  debug?: boolean;
};

function describeValue(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (typeof v === "object") {
    const o = v as { constructor?: { name?: string }; fd?: number; _handle?: { fd?: number } };
    if (o.constructor?.name && o.constructor.name !== "Object") {
      return o.constructor.name;
    }
    if (typeof o.fd === "number") return `fd=${o.fd}`;
    if (typeof o._handle?.fd === "number") return `fd=${o._handle.fd}`;
  }
  return String(v).slice(0, 80);
}

/** Snapshot Node active handles/requests (CLI debugging for hung processes). */
export function snapshotActiveHandles(): ActiveHandleSnapshot {
  const proc = process as NodeJS.Process & {
    _getActiveHandles?: () => unknown[];
    _getActiveRequests?: () => unknown[];
  };
  const handles = proc._getActiveHandles?.() ?? [];
  const requests = proc._getActiveRequests?.() ?? [];
  return {
    handleCount: handles.length,
    requestCount: requests.length,
    handles: handles.slice(0, 40).map((h, index) => ({
      index,
      type: (h as { constructor?: { name?: string } })?.constructor?.name ?? typeof h,
      detail: describeValue(h),
    })),
    requests: requests.slice(0, 40).map((r, index) => ({
      index,
      type: (r as { constructor?: { name?: string } })?.constructor?.name ?? typeof r,
      detail: describeValue(r),
    })),
  };
}

export function logRecoveryLifecycle(
  phase: "before_summary" | "after_summary" | "before_shutdown" | "after_cleanup",
  extra?: Record<string, unknown>,
): void {
  console.info(
    JSON.stringify({
      event: "sra_recover_lifecycle",
      phase,
      pid: process.pid,
      at: new Date().toISOString(),
      ...extra,
    }),
  );
}

/** Release Playwright browser, Prisma pool, and other CLI-held resources. */
export async function cleanupRecoveryProcess(
  opts: RecoveryShutdownOptions = {},
): Promise<{ lawSocietyClosed: boolean; prismaDisconnected: boolean }> {
  let lawSocietyClosed = false;
  let prismaDisconnected = false;

  if (opts.closeLawSociety !== false) {
    try {
      await closeLawSocietyBrowser();
      lawSocietyClosed = true;
    } catch (e) {
      if (opts.debug) {
        console.info(
          JSON.stringify({
            event: "sra_recover_cleanup_warning",
            resource: "law_society_browser",
            error: e instanceof Error ? e.message : String(e),
          }),
        );
      }
    }
  }

  if (opts.prisma) {
    try {
      await opts.prisma.$disconnect();
      prismaDisconnected = true;
    } catch (e) {
      if (opts.debug) {
        console.info(
          JSON.stringify({
            event: "sra_recover_cleanup_warning",
            resource: "prisma",
            error: e instanceof Error ? e.message : String(e),
          }),
        );
      }
    }
  }

  return { lawSocietyClosed, prismaDisconnected };
}

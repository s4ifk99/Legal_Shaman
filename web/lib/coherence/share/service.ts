import "server-only";

import { Prisma } from "@prisma/client";

import { accountsPrisma } from "@/lib/db/accounts";
import type { SolicitorBriefV0 } from "@/lib/coherence/briefSchema";
import { validateSolicitorBriefShape } from "@/lib/coherence/briefSchema";
import {
  hashShareToken,
  MAX_SHARE_PAYLOAD_BYTES,
  newShareToken,
  SHARE_TTL_MS,
  shareIsReadable,
} from "./crypto";
import {
  diskFindByTokenHash,
  diskFindByUpdateHash,
  diskRevokeByUpdateHash,
  diskUpsertShare,
  type DiskShareRow,
} from "./disk-store";
import { shareNotesUrl } from "./urls";

export type ShareView = {
  brief: SolicitorBriefV0;
  publishedAt: string;
  expiresAt: string;
};

export type ShareWriteResult =
  | {
      ok: true;
      created: boolean;
      url: string;
      updateSecret: string;
      expiresAt: string;
      publishedAt: string;
    }
  | { ok: false; error: string; status: number };

type ShareRow = {
  expiresAt: Date;
  revokedAt: Date | null;
  publishedAt: Date;
  payload: unknown;
};

function payloadBytes(brief: SolicitorBriefV0): number {
  return Buffer.byteLength(JSON.stringify(brief), "utf8");
}

function asBrief(payload: unknown): SolicitorBriefV0 | null {
  const errors = validateSolicitorBriefShape(payload);
  if (errors.length) return null;
  return payload as SolicitorBriefV0;
}

function fromDisk(row: DiskShareRow): ShareRow {
  return {
    expiresAt: new Date(row.expiresAt),
    revokedAt: row.revokedAt ? new Date(row.revokedAt) : null,
    publishedAt: new Date(row.publishedAt),
    payload: row.payload,
  };
}

function viewFromRow(row: ShareRow): ShareView | null {
  if (!shareIsReadable(row)) return null;
  const brief = asBrief(row.payload);
  if (!brief) return null;
  return {
    brief,
    publishedAt: row.publishedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  };
}

export async function createOrUpdateShare(opts: {
  brief: SolicitorBriefV0;
  consent: boolean;
  origin: string;
  updateSecret?: string;
  knownPathToken?: string;
}): Promise<ShareWriteResult> {
  if (!opts.consent) {
    return { ok: false, error: "consent_required", status: 400 };
  }
  const errors = validateSolicitorBriefShape(opts.brief);
  if (errors.length) {
    return { ok: false, error: "invalid_brief", status: 400 };
  }
  if (payloadBytes(opts.brief) > MAX_SHARE_PAYLOAD_BYTES) {
    return { ok: false, error: "payload_too_large", status: 413 };
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + SHARE_TTL_MS);
  const brief = {
    ...opts.brief,
    handoff: { ...opts.brief.handoff, consent_to_share: true },
  };
  const payload = brief as Prisma.InputJsonValue;

  if (opts.updateSecret) {
    const token = opts.knownPathToken;
    if (!token) {
      return { ok: false, error: "missing_share_token", status: 400 };
    }
    const updateTokenHash = hashShareToken(opts.updateSecret);
    try {
      const existing = await accountsPrisma.chronologyShare.findFirst({
        where: { updateTokenHash },
      });
      if (!existing || !shareIsReadable(existing)) {
        return { ok: false, error: "share_not_found", status: 404 };
      }
      const next = await accountsPrisma.chronologyShare.update({
        where: { id: existing.id },
        data: {
          payload,
          briefId: brief.brief_id,
          publishedAt: now,
          expiresAt,
          consentAt: now,
        },
      });
      return {
        ok: true,
        created: false,
        url: shareNotesUrl(opts.origin, token),
        updateSecret: opts.updateSecret,
        expiresAt: next.expiresAt.toISOString(),
        publishedAt: next.publishedAt.toISOString(),
      };
    } catch {
      const existing = diskFindByUpdateHash(updateTokenHash);
      if (!existing || !shareIsReadable(fromDisk(existing))) {
        return { ok: false, error: "share_not_found", status: 404 };
      }
      diskUpsertShare({
        ...existing,
        briefId: brief.brief_id,
        payload: brief,
        publishedAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        consentAt: now.toISOString(),
        revokedAt: null,
      });
      return {
        ok: true,
        created: false,
        url: shareNotesUrl(opts.origin, token),
        updateSecret: opts.updateSecret,
        expiresAt: expiresAt.toISOString(),
        publishedAt: now.toISOString(),
      };
    }
  }

  const token = newShareToken();
  const updateSecret = newShareToken();
  const tokenHash = hashShareToken(token);
  const updateTokenHash = hashShareToken(updateSecret);

  try {
    await accountsPrisma.chronologyShare.create({
      data: {
        tokenHash,
        updateTokenHash,
        briefId: brief.brief_id,
        expiresAt,
        consentAt: now,
        publishedAt: now,
        payload,
      },
    });
  } catch {
    diskUpsertShare({
      tokenHash,
      updateTokenHash,
      briefId: brief.brief_id,
      expiresAt: expiresAt.toISOString(),
      revokedAt: null,
      consentAt: now.toISOString(),
      publishedAt: now.toISOString(),
      payload: brief,
    });
  }

  return {
    ok: true,
    created: true,
    url: shareNotesUrl(opts.origin, token),
    updateSecret,
    expiresAt: expiresAt.toISOString(),
    publishedAt: now.toISOString(),
  };
}

export async function getShareByToken(token: string): Promise<ShareView | null> {
  if (!token || token.length < 16) return null;
  const tokenHash = hashShareToken(token);
  try {
    const row = await accountsPrisma.chronologyShare.findUnique({
      where: { tokenHash },
    });
    if (row) return viewFromRow(row);
  } catch {
    /* accounts DB unreachable — try local disk */
  }
  const disk = diskFindByTokenHash(tokenHash);
  return disk ? viewFromRow(fromDisk(disk)) : null;
}

export async function revokeShare(opts: {
  updateSecret: string;
}): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const updateTokenHash = hashShareToken(opts.updateSecret);
  try {
    const row = await accountsPrisma.chronologyShare.findFirst({
      where: { updateTokenHash },
    });
    if (!row) return { ok: false, error: "share_not_found", status: 404 };
    if (row.revokedAt) return { ok: true };
    await accountsPrisma.chronologyShare.update({
      where: { id: row.id },
      data: { revokedAt: new Date() },
    });
    return { ok: true };
  } catch {
    if (!diskRevokeByUpdateHash(updateTokenHash)) {
      return { ok: false, error: "share_not_found", status: 404 };
    }
    return { ok: true };
  }
}

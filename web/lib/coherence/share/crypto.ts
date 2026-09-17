import { createHash, randomBytes } from "node:crypto";

export const SHARE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
export const MAX_SHARE_PAYLOAD_BYTES = 200_000;

export function hashShareToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newShareToken(): string {
  return randomBytes(32).toString("base64url");
}

export function shareIsReadable(row: {
  expiresAt: Date;
  revokedAt: Date | null;
}): boolean {
  if (row.revokedAt) return false;
  return row.expiresAt.getTime() > Date.now();
}

export { originFromRequest as siteOrigin } from "./urls";

import "server-only";

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export type DiskShareRow = {
  tokenHash: string;
  updateTokenHash: string;
  briefId: string;
  expiresAt: string;
  revokedAt: string | null;
  consentAt: string;
  publishedAt: string;
  payload: unknown;
};

function storePath(): string {
  const root = process.env.VERCEL ? "/tmp" : path.join(process.cwd(), ".data");
  return path.join(root, "chronology-shares.json");
}

function readRows(): DiskShareRow[] {
  try {
    const raw = readFileSync(storePath(), "utf8");
    const data = JSON.parse(raw) as DiskShareRow[];
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writeRows(rows: DiskShareRow[]) {
  const dir = path.dirname(storePath());
  mkdirSync(dir, { recursive: true });
  writeFileSync(storePath(), `${JSON.stringify(rows, null, 2)}\n`, "utf8");
}

export function diskFindByTokenHash(tokenHash: string): DiskShareRow | null {
  return readRows().find((row) => row.tokenHash === tokenHash) ?? null;
}

export function diskFindByUpdateHash(updateTokenHash: string): DiskShareRow | null {
  return readRows().find((row) => row.updateTokenHash === updateTokenHash) ?? null;
}

export function diskUpsertShare(row: DiskShareRow) {
  const rows = readRows().filter(
    (existing) =>
      existing.tokenHash !== row.tokenHash && existing.updateTokenHash !== row.updateTokenHash,
  );
  rows.unshift(row);
  writeRows(rows.slice(0, 200));
}

export function diskRevokeByUpdateHash(updateTokenHash: string): boolean {
  const rows = readRows();
  const index = rows.findIndex((row) => row.updateTokenHash === updateTokenHash);
  if (index < 0) return false;
  rows[index] = { ...rows[index], revokedAt: new Date().toISOString() };
  writeRows(rows);
  return true;
}

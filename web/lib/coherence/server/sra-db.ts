import { Pool } from "pg";

import { coherenceDatabaseUrl } from "@/lib/coherence/config";

let pool: Pool | null = null;
let commentsTableReady = false;

function resetPool() {
  if (pool) {
    void pool.end().catch(() => {});
    pool = null;
  }
}

export function getSraPool(): Pool | null {
  const databaseUrl = coherenceDatabaseUrl();
  if (!databaseUrl) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: databaseUrl,
      max: 4,
      idleTimeoutMillis: 20_000,
      connectionTimeoutMillis: 8_000,
    });
    pool.on("error", () => {
      resetPool();
    });
  }
  return pool;
}

export async function sraQuery<T = { rows: Record<string, unknown>[] }>(
  sql: string,
  params: unknown[] = [],
): Promise<T> {
  const p = getSraPool();
  if (!p) throw new Error("DATABASE_URL not set");
  try {
    return (await p.query(sql, params)) as T;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/terminated unexpectedly|ECONNRESET|connection/i.test(msg)) {
      resetPool();
      const retry = getSraPool();
      if (!retry) throw err;
      return (await retry.query(sql, params)) as T;
    }
    throw err;
  }
}

export async function ensureSraCommentsTable() {
  if (commentsTableReady || !coherenceDatabaseUrl()) return;
  await sraQuery(
    `
    CREATE TABLE IF NOT EXISTS sra_organisation_comments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      sra_id VARCHAR(64) NOT NULL,
      author_name VARCHAR(80) NOT NULL DEFAULT 'Anonymous',
      body TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT sra_organisation_comments_body_len CHECK (char_length(body) BETWEEN 1 AND 2000)
    )
  `,
  );
  await sraQuery(
    `
    CREATE INDEX IF NOT EXISTS sra_organisation_comments_sra_id_created_at_idx
      ON sra_organisation_comments (sra_id, created_at DESC)
  `,
  );
  commentsTableReady = true;
}

export function mapCommentRow(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    sraId: String(row.sra_id),
    authorName: String(row.author_name || "Anonymous"),
    body: String(row.body),
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}

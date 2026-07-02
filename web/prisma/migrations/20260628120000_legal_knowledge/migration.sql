-- Legal knowledge chunks for Exa-style semantic search (UK legal help sources).

CREATE TABLE IF NOT EXISTS legal_sources (
  id TEXT PRIMARY KEY,
  domain TEXT NOT NULL,
  name TEXT NOT NULL,
  authority_weight DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  jurisdiction TEXT NOT NULL DEFAULT 'England and Wales',
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS legal_sources_domain_key ON legal_sources (domain);

CREATE TABLE IF NOT EXISTS legal_documents (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES legal_sources(id) ON DELETE CASCADE,
  source_url TEXT NOT NULL,
  title TEXT NOT NULL,
  domain TEXT NOT NULL,
  raw_text TEXT,
  clean_text TEXT NOT NULL,
  markdown TEXT,
  fetched_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source_updated_at TIMESTAMPTZ(3),
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS legal_documents_source_url_key ON legal_documents (source_url);
CREATE INDEX IF NOT EXISTS legal_documents_source_id_idx ON legal_documents (source_id);
CREATE INDEX IF NOT EXISTS legal_documents_domain_idx ON legal_documents (domain);

CREATE TABLE IF NOT EXISTS legal_chunks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES legal_documents(id) ON DELETE CASCADE,
  source_url TEXT NOT NULL,
  title TEXT NOT NULL,
  heading TEXT,
  chunk_text TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  token_count INTEGER NOT NULL DEFAULT 0,
  embedding vector(1536),
  fetched_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS legal_chunks_document_id_idx ON legal_chunks (document_id);
CREATE INDEX IF NOT EXISTS legal_chunks_source_url_idx ON legal_chunks (source_url);
CREATE INDEX IF NOT EXISTS legal_chunks_fts_idx ON legal_chunks
  USING GIN (to_tsvector('english', coalesce(heading, '') || ' ' || chunk_text));

CREATE INDEX IF NOT EXISTS legal_chunks_embedding_hnsw_idx ON legal_chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE TABLE IF NOT EXISTS ingestion_runs (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  documents_processed INTEGER NOT NULL DEFAULT 0,
  chunks_created INTEGER NOT NULL DEFAULT 0,
  embeddings_created INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  errors JSONB,
  started_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMPTZ(3)
);

CREATE INDEX IF NOT EXISTS ingestion_runs_started_at_idx ON ingestion_runs (started_at DESC);

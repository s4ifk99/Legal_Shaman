-- Knowledge compiler: concept graph for pre-connected wiki guidance

CREATE TABLE IF NOT EXISTS knowledge_concepts (
  id TEXT PRIMARY KEY,
  taxonomy_slug VARCHAR(64),
  wiki_page_id VARCHAR(1024) NOT NULL UNIQUE,
  title VARCHAR(512) NOT NULL,
  area_path VARCHAR(512),
  summary_text TEXT,
  embedding vector(1536),
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS knowledge_concepts_taxonomy_slug_idx ON knowledge_concepts (taxonomy_slug);
CREATE INDEX IF NOT EXISTS knowledge_concepts_area_path_idx ON knowledge_concepts (area_path);

CREATE TABLE IF NOT EXISTS knowledge_claims (
  id TEXT PRIMARY KEY,
  concept_id TEXT NOT NULL REFERENCES knowledge_concepts(id) ON DELETE CASCADE,
  source_url VARCHAR(2048),
  claim_text TEXT NOT NULL,
  section_target VARCHAR(64),
  extracted_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS knowledge_claims_concept_id_idx ON knowledge_claims (concept_id);

CREATE TABLE IF NOT EXISTS knowledge_edges (
  id TEXT PRIMARY KEY,
  from_concept_id TEXT NOT NULL REFERENCES knowledge_concepts(id) ON DELETE CASCADE,
  to_concept_id TEXT NOT NULL REFERENCES knowledge_concepts(id) ON DELETE CASCADE,
  edge_type VARCHAR(32) NOT NULL,
  UNIQUE (from_concept_id, to_concept_id, edge_type)
);

CREATE INDEX IF NOT EXISTS knowledge_edges_from_idx ON knowledge_edges (from_concept_id);
CREATE INDEX IF NOT EXISTS knowledge_edges_to_idx ON knowledge_edges (to_concept_id);

CREATE TABLE IF NOT EXISTS knowledge_contradictions (
  id TEXT PRIMARY KEY,
  claim_a_id TEXT NOT NULL REFERENCES knowledge_claims(id) ON DELETE CASCADE,
  claim_b_id TEXT NOT NULL REFERENCES knowledge_claims(id) ON DELETE CASCADE,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  rationale TEXT,
  detected_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMPTZ(3)
);

CREATE INDEX IF NOT EXISTS knowledge_contradictions_status_idx ON knowledge_contradictions (status);

CREATE TABLE IF NOT EXISTS knowledge_integration_runs (
  id TEXT PRIMARY KEY,
  source_url VARCHAR(2048),
  source_type VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'running',
  concepts_created INT NOT NULL DEFAULT 0,
  concepts_updated INT NOT NULL DEFAULT 0,
  claims_created INT NOT NULL DEFAULT 0,
  contradiction_count INT NOT NULL DEFAULT 0,
  errors JSONB,
  started_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMPTZ(3)
);

CREATE INDEX IF NOT EXISTS knowledge_integration_runs_started_at_idx ON knowledge_integration_runs (started_at);

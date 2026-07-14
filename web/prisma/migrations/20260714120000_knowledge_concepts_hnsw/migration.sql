CREATE INDEX IF NOT EXISTS knowledge_concepts_embedding_hnsw_idx ON knowledge_concepts
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

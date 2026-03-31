-- 004_knowledge_graph.sql
-- Knowledge graph: edges between entities
CREATE TABLE edges (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id  uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  target_id  uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  relation   text NOT NULL,
  confidence float NOT NULL DEFAULT 1.0 CHECK (confidence >= 0 AND confidence <= 1),
  source     text,
  metadata   jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (source_id, target_id, relation)
);

CREATE INDEX idx_edges_source ON edges (source_id);
CREATE INDEX idx_edges_target ON edges (target_id);
CREATE INDEX idx_edges_relation ON edges (relation);

-- LLM extraction status tracking
ALTER TABLE entities
  ADD COLUMN extraction_status text CHECK (extraction_status IN ('pending', 'completed', 'failed'));

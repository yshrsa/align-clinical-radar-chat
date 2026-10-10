CREATE TABLE IF NOT EXISTS evidence_documents (
  pmid TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  abstract_en TEXT NOT NULL DEFAULT '',
  summary_en TEXT NOT NULL DEFAULT '',
  summary_ja TEXT NOT NULL DEFAULT '',
  key_takeaway_ja TEXT NOT NULL DEFAULT '',
  why_matters_ja TEXT NOT NULL DEFAULT '',
  study_type_ja TEXT NOT NULL DEFAULT '',
  endpoints_ja TEXT NOT NULL DEFAULT '',
  endpoint_results_ja TEXT NOT NULL DEFAULT '',
  sample_size_ja TEXT NOT NULL DEFAULT '',
  journal TEXT NOT NULL DEFAULT '',
  authors_json TEXT NOT NULL DEFAULT '[]',
  publication_date TEXT NOT NULL DEFAULT '',
  doi TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  publication_types_json TEXT NOT NULL DEFAULT '[]',
  mesh_terms_json TEXT NOT NULL DEFAULT '[]',
  assets_json TEXT NOT NULL DEFAULT '[]',
  companies_json TEXT NOT NULL DEFAULT '[]',
  topics_json TEXT NOT NULL DEFAULT '[]',
  focal_related INTEGER NOT NULL DEFAULT 0,
  japan_relevant INTEGER NOT NULL DEFAULT 0,
  source_content_sha256 TEXT NOT NULL DEFAULT '',
  evidence_sha256 TEXT NOT NULL,
  fetched_at_utc TEXT NOT NULL DEFAULT '',
  source_updated_at_utc TEXT NOT NULL DEFAULT '',
  summary_model TEXT NOT NULL DEFAULT '',
  summary_generated_at_utc TEXT NOT NULL DEFAULT '',
  summary_status TEXT NOT NULL CHECK (summary_status IN ('complete', 'pending')),
  synced_at_utc TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_evidence_date ON evidence_documents(publication_date DESC);
CREATE INDEX IF NOT EXISTS idx_evidence_summary_status_date ON evidence_documents(summary_status, publication_date DESC);
CREATE INDEX IF NOT EXISTS idx_evidence_focal_date ON evidence_documents(focal_related, publication_date DESC);

CREATE TABLE IF NOT EXISTS evidence_sync_state (
  source TEXT PRIMARY KEY,
  source_generated_at_utc TEXT NOT NULL DEFAULT '',
  document_count INTEGER NOT NULL DEFAULT 0,
  last_full_sync_at_utc TEXT,
  last_delta_sync_at_utc TEXT,
  updated_at_utc TEXT NOT NULL
);

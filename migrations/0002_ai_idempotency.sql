CREATE TABLE IF NOT EXISTS ai_requests (
  request_key TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  date_utc TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('processing', 'completed', 'failed')),
  response_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_requests_date_kind ON ai_requests(date_utc, kind);


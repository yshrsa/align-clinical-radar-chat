CREATE TABLE IF NOT EXISTS industry_news (
  article_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  published_date TEXT NOT NULL DEFAULT '',
  source_id TEXT NOT NULL DEFAULT '',
  source_name TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL DEFAULT '',
  feed_url TEXT NOT NULL DEFAULT '',
  source_category TEXT NOT NULL DEFAULT '',
  source_categories_json TEXT NOT NULL DEFAULT '[]',
  snippet_en TEXT NOT NULL DEFAULT '',
  summary_ja TEXT NOT NULL DEFAULT '',
  key_takeaway_ja TEXT NOT NULL DEFAULT '',
  assets_json TEXT NOT NULL DEFAULT '[]',
  companies_json TEXT NOT NULL DEFAULT '[]',
  topics_json TEXT NOT NULL DEFAULT '[]',
  focal_related INTEGER NOT NULL DEFAULT 0,
  japan_relevant INTEGER NOT NULL DEFAULT 0,
  summary_model TEXT NOT NULL DEFAULT '',
  summary_generated_at_utc TEXT NOT NULL DEFAULT '',
  summary_status TEXT NOT NULL CHECK (summary_status IN ('complete', 'pending')),
  first_seen_at_utc TEXT NOT NULL,
  last_seen_at_utc TEXT NOT NULL,
  article_sha256 TEXT NOT NULL,
  synced_at_utc TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_industry_news_url ON industry_news(url);
CREATE INDEX IF NOT EXISTS idx_industry_news_published ON industry_news(published_date DESC);
CREATE INDEX IF NOT EXISTS idx_industry_news_source_date ON industry_news(source_id, published_date DESC);
CREATE INDEX IF NOT EXISTS idx_industry_news_summary_date ON industry_news(summary_status, published_date DESC);
CREATE INDEX IF NOT EXISTS idx_industry_news_focal_date ON industry_news(focal_related, published_date DESC);

CREATE TABLE IF NOT EXISTS industry_news_sync_state (
  source TEXT PRIMARY KEY,
  source_generated_at_utc TEXT NOT NULL DEFAULT '',
  source_document_count INTEGER NOT NULL DEFAULT 0,
  archived_document_count INTEGER NOT NULL DEFAULT 0,
  last_full_sync_at_utc TEXT,
  last_delta_sync_at_utc TEXT,
  updated_at_utc TEXT NOT NULL
);

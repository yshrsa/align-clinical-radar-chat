ALTER TABLE industry_news ADD COLUMN published_at_utc TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_industry_news_published_at ON industry_news(published_at_utc DESC);

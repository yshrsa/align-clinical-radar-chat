CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  citations_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  FOREIGN KEY(thread_id) REFERENCES threads(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_threads_owner_updated ON threads(owner_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_thread_created ON messages(thread_id, created_at);

CREATE TABLE IF NOT EXISTS ai_budget (
  date_utc TEXT PRIMARY KEY,
  summary_reserved_neurons INTEGER NOT NULL DEFAULT 0,
  chat_reserved_neurons INTEGER NOT NULL DEFAULT 0,
  summary_calls INTEGER NOT NULL DEFAULT 0,
  chat_calls INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

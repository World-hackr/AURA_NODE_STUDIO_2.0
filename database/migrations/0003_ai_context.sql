PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS ai_project_memory (
  id TEXT PRIMARY KEY,
  project_key TEXT NOT NULL UNIQUE,
  memory_json TEXT NOT NULL,
  summary_text TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_patch_history (
  id TEXT PRIMARY KEY,
  project_key TEXT NOT NULL,
  request_mode TEXT NOT NULL,
  provider TEXT,
  model_name TEXT,
  user_message TEXT,
  scene_schema TEXT,
  scene_revision INTEGER,
  selection_summary TEXT,
  layout_intent_json TEXT,
  patch_json TEXT,
  status TEXT NOT NULL,
  assistant_message TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_project_memory_project_key
  ON ai_project_memory(project_key);

CREATE INDEX IF NOT EXISTS idx_ai_patch_history_project_key_created_at
  ON ai_patch_history(project_key, created_at DESC);

PRAGMA foreign_keys = ON;

CREATE TABLE component_packages (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  current_revision_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE component_package_revisions (
  id TEXT PRIMARY KEY,
  package_id TEXT NOT NULL,
  revision_number INTEGER NOT NULL,
  component_json TEXT NOT NULL,
  scene_svg TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  source_label TEXT,
  review_notes TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (package_id) REFERENCES component_packages(id) ON DELETE CASCADE,
  UNIQUE(package_id, revision_number)
);

CREATE TABLE component_aliases (
  id TEXT PRIMARY KEY,
  package_id TEXT NOT NULL,
  alias TEXT NOT NULL,
  alias_normalized TEXT NOT NULL,
  alias_kind TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (package_id) REFERENCES component_packages(id) ON DELETE CASCADE
);

CREATE INDEX idx_component_aliases_normalized
  ON component_aliases(alias_normalized);

CREATE TABLE circuit_projects (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE circuit_revisions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  revision_number INTEGER NOT NULL,
  circuit_intent_json TEXT,
  circuit_ir_json TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES circuit_projects(id) ON DELETE CASCADE,
  UNIQUE(project_id, revision_number)
);

CREATE TABLE import_jobs (
  id TEXT PRIMARY KEY,
  source_kind TEXT NOT NULL,
  source_name TEXT NOT NULL,
  status TEXT NOT NULL,
  source_payload_json TEXT,
  result_payload_json TEXT,
  user_notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE ai_generation_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  prompt_text TEXT NOT NULL,
  model_name TEXT,
  status TEXT NOT NULL,
  circuit_intent_json TEXT,
  result_notes TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES circuit_projects(id) ON DELETE SET NULL
);

PRAGMA foreign_keys = ON;

CREATE TABLE schematic_projects (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE schematic_revisions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  revision_number INTEGER NOT NULL,
  source_kind TEXT NOT NULL,
  schematic_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES schematic_projects(id) ON DELETE CASCADE,
  UNIQUE(project_id, revision_number)
);

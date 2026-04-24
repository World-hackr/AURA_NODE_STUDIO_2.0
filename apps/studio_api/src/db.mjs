import { mkdir, readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(__dirname, "..");
const workspaceRoot = resolve(appRoot, "../..");
const databaseRoot = resolve(workspaceRoot, "database");
const migrationsRoot = resolve(databaseRoot, "migrations");
const databasePath = resolve(databaseRoot, "aura_studio.db");

function nowIso() {
  return new Date().toISOString();
}

function slugify(value) {
  return (value.trim() || "project")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "project";
}

export function getDatabasePath() {
  return databasePath;
}

async function ensureDatabaseFolder() {
  await mkdir(databaseRoot, { recursive: true });
}

function openDatabase() {
  const db = new DatabaseSync(databasePath);
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  return db;
}

function safeRollback(db) {
  try {
    db.exec("ROLLBACK;");
  } catch {
    // Ignore rollback failures when SQLite has already closed the transaction.
  }
}

function isAlreadyAppliedMigrationError(error) {
  const message = String(error?.message || "").toLowerCase();
  return message.includes("already exists");
}

function ensureSchemaMigrationsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
}

export async function migrateDatabase() {
  await ensureDatabaseFolder();

  const db = openDatabase();
  try {
    ensureSchemaMigrationsTable(db);

    const migrationFiles = (await readdir(migrationsRoot))
      .filter((file) => file.endsWith(".sql"))
      .sort();

    const applied = new Set(
      db.prepare("SELECT id FROM schema_migrations ORDER BY id").all().map((entry) => entry.id),
    );

    const newlyApplied = [];
    for (const file of migrationFiles) {
      if (applied.has(file)) {
        continue;
      }

      const sql = await readFile(resolve(migrationsRoot, file), "utf8");
      db.exec("BEGIN;");
      try {
        db.exec(sql);
        db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)")
          .run(file, nowIso());
        db.exec("COMMIT;");
        newlyApplied.push(file);
      } catch (error) {
        safeRollback(db);
        if (isAlreadyAppliedMigrationError(error)) {
          db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)")
            .run(file, nowIso());
          newlyApplied.push(file);
          continue;
        }
        throw error;
      }
    }

    const appliedNow = db.prepare("SELECT id, applied_at FROM schema_migrations ORDER BY id").all();

    return {
      databasePath,
      appliedMigrations: appliedNow,
      newlyApplied,
    };
  } finally {
    db.close();
  }
}

export async function getDatabaseStatus() {
  const migrationState = await migrateDatabase();
  const db = openDatabase();
  try {
    const counts = {
      componentPackages: db.prepare("SELECT COUNT(*) AS count FROM component_packages").get().count,
      circuitProjects: db.prepare("SELECT COUNT(*) AS count FROM circuit_projects").get().count,
      schematicProjects: db.prepare("SELECT COUNT(*) AS count FROM schematic_projects").get().count,
      importJobs: db.prepare("SELECT COUNT(*) AS count FROM import_jobs").get().count,
      aiGenerationRuns: db.prepare("SELECT COUNT(*) AS count FROM ai_generation_runs").get().count,
      aiProjectMemory: db.prepare("SELECT COUNT(*) AS count FROM ai_project_memory").get().count,
      aiPatchHistory: db.prepare("SELECT COUNT(*) AS count FROM ai_patch_history").get().count,
    };

    return {
      databasePath: migrationState.databasePath,
      appliedMigrations: migrationState.appliedMigrations,
      counts,
    };
  } finally {
    db.close();
  }
}

function normalizeProjectKey(projectKey) {
  const normalized = String(projectKey || "").trim();
  return normalized || "studio-canvas";
}

function parseJsonOrNull(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export async function getAiProjectContext(projectKey, { historyLimit = 8 } = {}) {
  await migrateDatabase();
  const db = openDatabase();
  try {
    const normalizedProjectKey = normalizeProjectKey(projectKey);
    const memoryRow = db.prepare(`
      SELECT id, project_key, memory_json, summary_text, created_at, updated_at
      FROM ai_project_memory
      WHERE project_key = ?
    `).get(normalizedProjectKey);

    const historyRows = db.prepare(`
      SELECT
        id,
        project_key,
        request_mode,
        provider,
        model_name,
        user_message,
        scene_schema,
        scene_revision,
        selection_summary,
        layout_intent_json,
        patch_json,
        status,
        assistant_message,
        created_at
      FROM ai_patch_history
      WHERE project_key = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(normalizedProjectKey, Math.max(1, Number(historyLimit) || 8));

    return {
      projectKey: normalizedProjectKey,
      memory: memoryRow ? {
        id: memoryRow.id,
        projectKey: memoryRow.project_key,
        memory: parseJsonOrNull(memoryRow.memory_json) ?? {},
        summaryText: memoryRow.summary_text || "",
        createdAt: memoryRow.created_at,
        updatedAt: memoryRow.updated_at,
      } : null,
      recentHistory: historyRows.map((row) => ({
        id: row.id,
        projectKey: row.project_key,
        requestMode: row.request_mode,
        provider: row.provider,
        modelName: row.model_name,
        userMessage: row.user_message || "",
        sceneSchema: row.scene_schema || "",
        sceneRevision: Number.isInteger(row.scene_revision) ? row.scene_revision : null,
        selectionSummary: row.selection_summary || "",
        layoutIntent: parseJsonOrNull(row.layout_intent_json),
        patch: parseJsonOrNull(row.patch_json),
        status: row.status,
        assistantMessage: row.assistant_message || "",
        createdAt: row.created_at,
      })),
    };
  } finally {
    db.close();
  }
}

export async function upsertAiProjectMemory({
  projectKey,
  memory,
  summaryText = "",
}) {
  await migrateDatabase();
  const db = openDatabase();
  try {
    const normalizedProjectKey = normalizeProjectKey(projectKey);
    const timestamp = nowIso();
    const existing = db.prepare(`
      SELECT id
      FROM ai_project_memory
      WHERE project_key = ?
    `).get(normalizedProjectKey);

    const recordId = existing?.id ?? randomUUID();
    const memoryJson = JSON.stringify(memory ?? {}, null, 2);

    db.exec("BEGIN;");
    try {
      if (existing) {
        db.prepare(`
          UPDATE ai_project_memory
          SET memory_json = ?, summary_text = ?, updated_at = ?
          WHERE id = ?
        `).run(memoryJson, summaryText || "", timestamp, existing.id);
      } else {
        db.prepare(`
          INSERT INTO ai_project_memory (id, project_key, memory_json, summary_text, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(recordId, normalizedProjectKey, memoryJson, summaryText || "", timestamp, timestamp);
      }
      db.exec("COMMIT;");
    } catch (error) {
      safeRollback(db);
      throw error;
    }

    return getAiProjectContext(normalizedProjectKey, { historyLimit: 8 });
  } finally {
    db.close();
  }
}

export async function recordAiPatchHistory({
  projectKey,
  requestMode,
  provider = null,
  modelName = null,
  userMessage = "",
  sceneSchema = null,
  sceneRevision = null,
  selectionSummary = "",
  layoutIntent = null,
  patch = null,
  status,
  assistantMessage = "",
}) {
  await migrateDatabase();
  const db = openDatabase();
  try {
    const normalizedProjectKey = normalizeProjectKey(projectKey);
    const timestamp = nowIso();
    db.prepare(`
      INSERT INTO ai_patch_history (
        id,
        project_key,
        request_mode,
        provider,
        model_name,
        user_message,
        scene_schema,
        scene_revision,
        selection_summary,
        layout_intent_json,
        patch_json,
        status,
        assistant_message,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      normalizedProjectKey,
      String(requestMode || "unknown"),
      provider,
      modelName,
      String(userMessage || ""),
      sceneSchema,
      Number.isInteger(sceneRevision) ? sceneRevision : null,
      String(selectionSummary || ""),
      layoutIntent == null ? null : JSON.stringify(layoutIntent, null, 2),
      patch == null ? null : JSON.stringify(patch, null, 2),
      String(status || "unknown"),
      String(assistantMessage || ""),
      timestamp,
    );
  } finally {
    db.close();
  }
}

export async function saveCircuitProject({
  slug,
  name,
  description = null,
  circuitIntent = null,
  circuitIr,
  sourceKind = "manual",
}) {
  await migrateDatabase();
  const db = openDatabase();
  try {
    const resolvedSlug = slugify(slug || name || "project");
    const existing = db
      .prepare("SELECT id, slug, name, description FROM circuit_projects WHERE slug = ?")
      .get(resolvedSlug);

    const timestamp = nowIso();
    let projectId = existing?.id ?? randomUUID();
    let revisionNumber = 1;

    db.exec("BEGIN;");
    try {
      if (existing) {
        db.prepare(`
          UPDATE circuit_projects
          SET name = ?, description = ?, updated_at = ?
          WHERE id = ?
        `).run(name, description, timestamp, existing.id);

        const row = db
          .prepare("SELECT COALESCE(MAX(revision_number), 0) AS max_revision FROM circuit_revisions WHERE project_id = ?")
          .get(existing.id);
        revisionNumber = Number(row.max_revision) + 1;
      } else {
        db.prepare(`
          INSERT INTO circuit_projects (id, slug, name, description, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'draft', ?, ?)
        `).run(projectId, resolvedSlug, name, description, timestamp, timestamp);
      }

      const revisionId = randomUUID();
      db.prepare(`
        INSERT INTO circuit_revisions (
          id,
          project_id,
          revision_number,
          circuit_intent_json,
          circuit_ir_json,
          source_kind,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        revisionId,
        projectId,
        revisionNumber,
        circuitIntent == null ? null : JSON.stringify(circuitIntent, null, 2),
        JSON.stringify(circuitIr, null, 2),
        sourceKind,
        timestamp,
      );
      db.exec("COMMIT;");

      const project = db
        .prepare("SELECT id, slug, name, description, status, created_at, updated_at FROM circuit_projects WHERE id = ?")
        .get(projectId);

      return {
        project,
        revision: {
          id: revisionId,
          revisionNumber,
          sourceKind,
          createdAt: timestamp,
        },
      };
    } catch (error) {
      safeRollback(db);
      throw error;
    }
  } finally {
    db.close();
  }
}

export async function listCircuitProjects() {
  await migrateDatabase();
  const db = openDatabase();
  try {
    return db.prepare(`
      SELECT
        p.id,
        p.slug,
        p.name,
        p.description,
        p.status,
        p.created_at,
        p.updated_at,
        COALESCE(MAX(r.revision_number), 0) AS latest_revision_number
      FROM circuit_projects p
      LEFT JOIN circuit_revisions r ON r.project_id = p.id
      GROUP BY p.id
      ORDER BY p.updated_at DESC
    `).all();
  } finally {
    db.close();
  }
}

export async function getCircuitProjectBySlug(slug) {
  await migrateDatabase();
  const db = openDatabase();
  try {
    const project = db
      .prepare("SELECT id, slug, name, description, status, created_at, updated_at FROM circuit_projects WHERE slug = ?")
      .get(slug);

    if (!project) {
      return null;
    }

    const revisions = db.prepare(`
      SELECT
        id,
        revision_number,
        circuit_intent_json,
        circuit_ir_json,
        source_kind,
        created_at
      FROM circuit_revisions
      WHERE project_id = ?
      ORDER BY revision_number DESC
    `).all(project.id).map((row) => ({
      id: row.id,
      revisionNumber: row.revision_number,
      circuitIntent: row.circuit_intent_json ? JSON.parse(row.circuit_intent_json) : null,
      circuitIr: JSON.parse(row.circuit_ir_json),
      sourceKind: row.source_kind,
      createdAt: row.created_at,
    }));

    return {
      ...project,
      revisions,
    };
  } finally {
    db.close();
  }
}

export async function saveSchematicProject({
  slug,
  name,
  description = null,
  schematic,
  sourceKind = "manual",
}) {
  await migrateDatabase();
  const db = openDatabase();
  try {
    const resolvedSlug = slugify(slug || name || "schematic");
    const existing = db
      .prepare("SELECT id, slug, name, description FROM schematic_projects WHERE slug = ?")
      .get(resolvedSlug);

    const timestamp = nowIso();
    const projectId = existing?.id ?? randomUUID();
    let revisionNumber = 1;

    db.exec("BEGIN;");
    try {
      if (existing) {
        db.prepare(`
          UPDATE schematic_projects
          SET name = ?, description = ?, updated_at = ?
          WHERE id = ?
        `).run(name, description, timestamp, existing.id);

        const row = db
          .prepare("SELECT COALESCE(MAX(revision_number), 0) AS max_revision FROM schematic_revisions WHERE project_id = ?")
          .get(existing.id);
        revisionNumber = Number(row.max_revision) + 1;
      } else {
        db.prepare(`
          INSERT INTO schematic_projects (id, slug, name, description, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'draft', ?, ?)
        `).run(projectId, resolvedSlug, name, description, timestamp, timestamp);
      }

      const revisionId = randomUUID();
      db.prepare(`
        INSERT INTO schematic_revisions (
          id,
          project_id,
          revision_number,
          source_kind,
          schematic_json,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        revisionId,
        projectId,
        revisionNumber,
        sourceKind,
        JSON.stringify(schematic, null, 2),
        timestamp,
      );

      db.exec("COMMIT;");

      const project = db
        .prepare("SELECT id, slug, name, description, status, created_at, updated_at FROM schematic_projects WHERE id = ?")
        .get(projectId);

      return {
        project,
        revision: {
          id: revisionId,
          revisionNumber,
          sourceKind,
          createdAt: timestamp,
        },
      };
    } catch (error) {
      safeRollback(db);
      throw error;
    }
  } finally {
    db.close();
  }
}

export async function listSchematicProjects() {
  await migrateDatabase();
  const db = openDatabase();
  try {
    return db.prepare(`
      SELECT
        p.id,
        p.slug,
        p.name,
        p.description,
        p.status,
        p.created_at,
        p.updated_at,
        COALESCE(MAX(r.revision_number), 0) AS latest_revision_number
      FROM schematic_projects p
      LEFT JOIN schematic_revisions r ON r.project_id = p.id
      GROUP BY p.id
      ORDER BY p.updated_at DESC
    `).all();
  } finally {
    db.close();
  }
}

export async function getSchematicProjectBySlug(slug) {
  await migrateDatabase();
  const db = openDatabase();
  try {
    const project = db
      .prepare("SELECT id, slug, name, description, status, created_at, updated_at FROM schematic_projects WHERE slug = ?")
      .get(slug);

    if (!project) {
      return null;
    }

    const revisions = db.prepare(`
      SELECT
        id,
        revision_number,
        source_kind,
        schematic_json,
        created_at
      FROM schematic_revisions
      WHERE project_id = ?
      ORDER BY revision_number DESC
    `).all(project.id).map((row) => ({
      id: row.id,
      revisionNumber: row.revision_number,
      sourceKind: row.source_kind,
      schematic: JSON.parse(row.schematic_json),
      createdAt: row.created_at,
    }));

    return {
      ...project,
      revisions,
    };
  } finally {
    db.close();
  }
}

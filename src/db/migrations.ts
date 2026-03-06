import * as path from "node:path";
import * as fs from "node:fs";
import type { Database as DatabaseType } from "better-sqlite3";
import { getDatabase } from "./connection.js";

const SCHEMA_VERSION = 1;

interface MigrationRecord {
  id: number;
  version: number;
  applied_at: number;
}

export function runMigrations(db?: DatabaseType): void {
  const database = db ?? getDatabase();

  database.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version INTEGER NOT NULL UNIQUE,
      applied_at INTEGER NOT NULL
    )
  `);

  const currentVersion = getCurrentVersion(database);

  if (currentVersion < SCHEMA_VERSION) {
    applyMigrations(database, currentVersion);
  }
}

function getCurrentVersion(db: DatabaseType): number {
  const row = db
    .prepare("SELECT MAX(version) as version FROM migrations")
    .get() as { version: number | null } | undefined;

  return row?.version ?? 0;
}

function applyMigrations(db: DatabaseType, fromVersion: number): void {
  const migrationsDir = path.join(__dirname, "migrations");

  if (fs.existsSync(migrationsDir)) {
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    for (const file of files) {
      const version = parseInt(file.split("-")[0], 10);
      if (version > fromVersion) {
        const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
        db.exec(sql);
        recordMigration(db, version);
      }
    }
  }

  if (fromVersion < 1) {
    applyInitialSchema(db);
  }
}

function applyInitialSchema(db: DatabaseType): void {
  const schemaPath = path.join(__dirname, "schema.sql");

  if (fs.existsSync(schemaPath)) {
    const schema = fs.readFileSync(schemaPath, "utf-8");
    db.exec(schema);
  } else {
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        task TEXT NOT NULL,
        working_dir TEXT NOT NULL,
        model TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'ready',
        plan_id TEXT,
        prompt_tokens INTEGER DEFAULT 0,
        completion_tokens INTEGER DEFAULT 0,
        total_tokens INTEGER DEFAULT 0,
        budget_remaining INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS steps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        action TEXT NOT NULL,
        tool TEXT NOT NULL,
        args TEXT NOT NULL,
        result TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT,
        tool_calls TEXT,
        tool_call_id TEXT,
        position INTEGER NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS checkpoints (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        step_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        state TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS feedback_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        session_id TEXT NOT NULL,
        plan_id TEXT,
        step_id TEXT,
        payload TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS plans (
        id TEXT PRIMARY KEY,
        description TEXT NOT NULL,
        steps TEXT NOT NULL,
        metadata TEXT NOT NULL,
        budget TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_steps_session_id ON steps(session_id);
      CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);
      CREATE INDEX IF NOT EXISTS idx_checkpoints_session_id ON checkpoints(session_id);
      CREATE INDEX IF NOT EXISTS idx_feedback_events_session_id ON feedback_events(session_id);
      CREATE INDEX IF NOT EXISTS idx_feedback_events_type ON feedback_events(type);
      CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
      CREATE INDEX IF NOT EXISTS idx_sessions_plan_id ON sessions(plan_id);
    `);
  }

  recordMigration(db, 1);
}

function recordMigration(db: DatabaseType, version: number): void {
  db.prepare(
    "INSERT OR IGNORE INTO migrations (version, applied_at) VALUES (?, ?)"
  ).run(version, Date.now());
}

export function getMigrationStatus(): {
  currentVersion: number;
  expectedVersion: number;
  pending: boolean;
} {
  const db = getDatabase();
  const currentVersion = getCurrentVersion(db);

  return {
    currentVersion,
    expectedVersion: SCHEMA_VERSION,
    pending: currentVersion < SCHEMA_VERSION,
  };
}

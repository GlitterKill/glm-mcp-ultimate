import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { runMigrations } from "../src/db/migrations.js";
import { getDatabase, closeDatabase, runInTransaction } from "../src/db/connection.js";

describe("Database Connection", () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "glm-test-"));
    dbPath = path.join(tempDir, "test.db");
    closeDatabase();
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("should create database file if not exists", () => {
    const db = getDatabase(dbPath);
    expect(db).toBeDefined();
    expect(fs.existsSync(dbPath)).toBe(true);
  });

  it("should return same database instance on multiple calls", () => {
    const db1 = getDatabase(dbPath);
    const db2 = getDatabase(dbPath);
    expect(db1).toBe(db2);
  });

  it("should close database properly", () => {
    getDatabase(dbPath);
    closeDatabase();

    const newDb = getDatabase(dbPath);
    expect(newDb).toBeDefined();
    closeDatabase();
  });

  it("should run operations in transaction", () => {
    const db = getDatabase(dbPath);
    db.exec("CREATE TABLE test_tx (id INTEGER PRIMARY KEY, value TEXT)");

    runInTransaction(() => {
      db.prepare("INSERT INTO test_tx (value) VALUES (?)").run("test1");
      db.prepare("INSERT INTO test_tx (value) VALUES (?)").run("test2");
    });

    const rows = db.prepare("SELECT COUNT(*) as count FROM test_tx").get() as {
      count: number;
    };
    expect(rows.count).toBe(2);
  });

  it("should rollback on error in transaction", () => {
    const db = getDatabase(dbPath);
    db.exec("CREATE TABLE test_rollback (id INTEGER PRIMARY KEY, value TEXT)");

    expect(() => {
      runInTransaction(() => {
        db.prepare("INSERT INTO test_rollback (value) VALUES (?)").run("test1");
        throw new Error("Intentional error");
      });
    }).toThrow("Intentional error");

    const rows = db
      .prepare("SELECT COUNT(*) as count FROM test_rollback")
      .get() as { count: number };
    expect(rows.count).toBe(0);
  });
});

describe("Database Migrations", () => {
  let tempDir: string;
  let dbPath: string;
  let db: Database.Database;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "glm-test-"));
    dbPath = path.join(tempDir, "test.db");
    db = new Database(dbPath);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("should create migrations table", () => {
    runMigrations(db);

    const table = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='migrations'"
      )
      .get();
    expect(table).toBeDefined();
  });

  it("should create all required tables", () => {
    runMigrations(db);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as { name: string }[];
    const tableNames = tables.map((t) => t.name);

    expect(tableNames).toContain("sessions");
    expect(tableNames).toContain("steps");
    expect(tableNames).toContain("messages");
    expect(tableNames).toContain("checkpoints");
    expect(tableNames).toContain("feedback_events");
    expect(tableNames).toContain("plans");
  });

  it("should create indexes", () => {
    runMigrations(db);

    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index'")
      .all() as { name: string }[];
    const indexNames = indexes.map((i) => i.name);

    expect(indexNames).toContain("idx_steps_session_id");
    expect(indexNames).toContain("idx_messages_session_id");
    expect(indexNames).toContain("idx_checkpoints_session_id");
    expect(indexNames).toContain("idx_feedback_events_session_id");
    expect(indexNames).toContain("idx_sessions_status");
  });

  it("should not reapply migrations", () => {
    runMigrations(db);
    runMigrations(db);

    const migrations = db
      .prepare("SELECT COUNT(*) as count FROM migrations")
      .get() as { count: number };
    expect(migrations.count).toBe(1);
  });

  it("should record migration version", () => {
    runMigrations(db);

    const migration = db
      .prepare("SELECT version FROM migrations WHERE version = 1")
      .get() as { version: number } | undefined;
    expect(migration).toBeDefined();
    expect(migration?.version).toBe(1);
  });

  it("should have correct sessions table schema", () => {
    runMigrations(db);

    const columns = db.pragma("table_info(sessions)") as {
      name: string;
      type: string;
      notnull: number;
      pk: number;
    }[];
    const columnNames = columns.map((c) => c.name);

    expect(columnNames).toContain("id");
    expect(columnNames).toContain("task");
    expect(columnNames).toContain("working_dir");
    expect(columnNames).toContain("model");
    expect(columnNames).toContain("status");
    expect(columnNames).toContain("plan_id");
    expect(columnNames).toContain("prompt_tokens");
    expect(columnNames).toContain("completion_tokens");
    expect(columnNames).toContain("total_tokens");
    expect(columnNames).toContain("budget_remaining");
    expect(columnNames).toContain("created_at");
    expect(columnNames).toContain("updated_at");
  });

  it("should have correct steps table schema", () => {
    runMigrations(db);

    const columns = db.pragma("table_info(steps)") as {
      name: string;
      type: string;
    }[];
    const columnNames = columns.map((c) => c.name);

    expect(columnNames).toContain("id");
    expect(columnNames).toContain("session_id");
    expect(columnNames).toContain("action");
    expect(columnNames).toContain("tool");
    expect(columnNames).toContain("args");
    expect(columnNames).toContain("result");
    expect(columnNames).toContain("timestamp");
  });

  it("should have foreign key constraints enabled", () => {
    runMigrations(db);

    const fkState = db.pragma("foreign_keys");
    expect(fkState).toEqual([{ foreign_keys: 1 }]);
  });
});

describe("Database Schema Operations", () => {
  let tempDir: string;
  let dbPath: string;
  let db: Database.Database;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "glm-test-"));
    dbPath = path.join(tempDir, "test.db");
    db = new Database(dbPath);
    runMigrations(db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("should insert and retrieve session", () => {
    const now = Date.now();
    db.prepare(
      `INSERT INTO sessions (id, task, working_dir, model, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run("test-session-1", "Test task", "/test/dir", "glm-5", "ready", now, now);

    const session = db
      .prepare("SELECT * FROM sessions WHERE id = ?")
      .get("test-session-1") as Record<string, unknown>;
    expect(session).toBeDefined();
    expect(session.task).toBe("Test task");
    expect(session.status).toBe("ready");
  });

  it("should cascade delete steps when session is deleted", () => {
    const now = Date.now();

    db.prepare(
      `INSERT INTO sessions (id, task, working_dir, model, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run("test-session-2", "Test", "/test", "glm-5", "ready", now, now);

    db.prepare(
      `INSERT INTO steps (session_id, action, tool, args, result, timestamp)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run("test-session-2", "test action", "test_tool", "{}", "ok", now);

    const stepsBefore = db
      .prepare("SELECT COUNT(*) as count FROM steps WHERE session_id = ?")
      .get("test-session-2") as { count: number };
    expect(stepsBefore.count).toBe(1);

    db.prepare("DELETE FROM sessions WHERE id = ?").run("test-session-2");

    const stepsAfter = db
      .prepare("SELECT COUNT(*) as count FROM steps WHERE session_id = ?")
      .get("test-session-2") as { count: number };
    expect(stepsAfter.count).toBe(0);
  });

  it("should enforce foreign key constraint on steps", () => {
    const now = Date.now();

    expect(() => {
      db.prepare(
        `INSERT INTO steps (session_id, action, tool, args, result, timestamp)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run("non-existent-session", "action", "tool", "{}", "result", now);
    }).toThrow();
  });

  it("should insert and retrieve messages in order", () => {
    const now = Date.now();

    db.prepare(
      `INSERT INTO sessions (id, task, working_dir, model, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run("msg-session", "Test", "/test", "glm-5", "ready", now, now);

    db.prepare(
      `INSERT INTO messages (session_id, role, content, position) VALUES (?, ?, ?, ?)`
    ).run("msg-session", "system", "System message", 0);
    db.prepare(
      `INSERT INTO messages (session_id, role, content, position) VALUES (?, ?, ?, ?)`
    ).run("msg-session", "user", "User message", 1);
    db.prepare(
      `INSERT INTO messages (session_id, role, content, position) VALUES (?, ?, ?, ?)`
    ).run("msg-session", "assistant", "Assistant message", 2);

    const messages = db
      .prepare("SELECT * FROM messages WHERE session_id = ? ORDER BY position")
      .all("msg-session") as { role: string; content: string }[];

    expect(messages).toHaveLength(3);
    expect(messages[0].role).toBe("system");
    expect(messages[1].role).toBe("user");
    expect(messages[2].role).toBe("assistant");
  });

  it("should store and retrieve JSON data correctly", () => {
    const now = Date.now();
    const complexArgs = {
      nested: { deep: { value: 42 } },
      array: [1, 2, 3],
      string: "test",
    };

    db.prepare(
      `INSERT INTO sessions (id, task, working_dir, model, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run("json-session", "Test", "/test", "glm-5", "ready", now, now);

    db.prepare(
      `INSERT INTO steps (session_id, action, tool, args, result, timestamp)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run("json-session", "action", "tool", JSON.stringify(complexArgs), "result", now);

    const step = db
      .prepare("SELECT args FROM steps WHERE session_id = ?")
      .get("json-session") as { args: string };

    const parsedArgs = JSON.parse(step.args);
    expect(parsedArgs.nested.deep.value).toBe(42);
    expect(parsedArgs.array).toEqual([1, 2, 3]);
  });
});

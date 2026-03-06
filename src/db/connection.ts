import Database from "better-sqlite3";
import * as path from "node:path";
import * as fs from "node:fs";
import type { Database as DatabaseType, Statement } from "better-sqlite3";

let db: DatabaseType | null = null;

export function getDatabase(dbPath?: string): DatabaseType {
  if (db) {
    return db;
  }

  const finalPath = dbPath ?? getDefaultDbPath();
  const dir = path.dirname(finalPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(finalPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export function runInTransaction<T>(fn: () => T): T {
  const database = getDatabase();
  const transaction = database.transaction(fn);
  return transaction();
}

export function getDefaultDbPath(): string {
  const dataDir = path.join(process.cwd(), "data");
  return path.join(dataDir, "sessions.db");
}

export function resetDatabase(): void {
  closeDatabase();
}

export type { DatabaseType, Statement };

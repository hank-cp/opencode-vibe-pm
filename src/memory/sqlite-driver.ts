/**
 * Runtime-adaptive SQLite Driver
 *
 * OpenCode Desktop (Electron) runs the plugin sidecar under Node.js, NOT Bun.
 * A static `import { Database } from 'bun:sqlite'` fails hard in Desktop because
 * the Node.js ESM loader chokes on the `bun:` protocol at module-link time —
 * the entire plugin (commands, tools, sidebar) never loads.
 *
 * This module uses a **computed dynamic import** (`new Function('...')`) so the
 * `bun:` protocol string is invisible to the Node.js static ESM parser.
 * At runtime we detect Bun vs Node.js and load the right built-in SQLite:
 *
 *   - Bun (CLI / TUI)   → `bun:sqlite`   (zero deps)
 *   - Node.js (Desktop) → `node:sqlite`   (built-in since Node 22, zero deps)
 *
 * Both drivers expose the same core API (Database, Statement), so the rest of
 * MemorySystem works without any branching.
 */

import { logger } from '../core';

// ─── Public interfaces (subset of bun:sqlite / node:sqlite we actually use) ───

export interface Database {
  close(): void;
  /** Execute DDL (CREATE/ALTER/DROP/PRAGMA). No parameters expected. */
  run(sql: string): void;
  prepare(sql: string): Statement;
}

export interface Statement {
  run(...params: unknown[]): { changes: number };
  get(...params: unknown[]): Record<string, unknown> | null;
  all(...params: unknown[]): Record<string, unknown>[];
}

// ─── Runtime detection ───

const IS_BUN = typeof (globalThis as Record<string, unknown>).Bun !== 'undefined';

/**
 * Open (or create) a SQLite database file.
 *
 * Under Bun this is synchronous, but the unified API is async so callers
 * can `await` regardless of runtime.
 */
export async function openDatabase(
  path: string,
  opts?: { create?: boolean },
): Promise<Database> {
  if (IS_BUN) {
    return openBunDatabase(path, opts);
  }
  return openNodeDatabase(path, opts);
}

// ─── Bun path ───

async function openBunDatabase(path: string, opts?: { create?: boolean }): Promise<Database> {
  // new Function() hides the `bun:` protocol from Node.js' static ESM parser.
  // This function is only called in Bun, so the import always succeeds.
  const importBunSQLite = new Function('return import("bun:sqlite")') as () => Promise<{
    Database: new (path: string, opts?: { create?: boolean }) => Database;
  }>;
  const { Database: BunDatabase } = await importBunSQLite();

  logger.debug('[sqlite-driver] using bun:sqlite');
  return new BunDatabase(path, opts);
}

// ─── Node.js path ───

async function openNodeDatabase(path: string, opts?: { create?: boolean }): Promise<Database> {
  // node:sqlite is built-in since Node 22 (Electron 41 ships Node 24).
  // DatabaseSync is the synchronous constructor.
  const { DatabaseSync } = await import('node:sqlite') as {
    DatabaseSync: new (path: string, opts?: { create?: boolean; open?: boolean }) => {
      exec(sql: string): void;
      prepare(sql: string): {
        run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
        get(...params: unknown[]): Record<string, unknown> | undefined;
        all(...params: unknown[]): Record<string, unknown>[];
      };
      close(): void;
    };
  };

  logger.debug('[sqlite-driver] using node:sqlite');

  const db = new DatabaseSync(path, { create: opts?.create, open: true });

  // node:sqlite uses db.exec() for DDL; bun:sqlite uses db.run().
  // We expose a bun:sqlite-compatible `run()` that delegates to exec() for DDL.
  return {
    close: () => db.close(),
    run: (sql: string) => db.exec(sql),
    prepare: (sql: string): Statement => {
      const stmt = db.prepare(sql);
      return {
        run: (...params: unknown[]) => stmt.run(...params),
        get: (...params: unknown[]) => stmt.get(...params) ?? null,
        all: (...params: unknown[]) => stmt.all(...params),
      };
    },
  };
}

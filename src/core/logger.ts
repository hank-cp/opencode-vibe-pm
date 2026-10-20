/**
 * Logging Utility
 *
 * OpenCode V2 removed `client.app.log()`, so the host log sink is gone. Logs now go to
 * the host console (`console.debug/info/warn/error`, which the OpenCode server captures)
 * and, when a data directory is known, are appended to `<dataDir>/logs/vibe-pm.log`.
 *
 * Public interface unchanged: logger.debug / info / warn / error.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ILogger } from './types.js';

// ─── Options ───

export interface LoggerOptions {
  /** When set, log lines are additionally appended to `<dataDir>/logs/vibe-pm.log`. */
  dataDir?: string;
}

type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

// ─── State ───

let logFile: string | null = null;
let enabled = true;

export function initLogger(options: LoggerOptions = {}): void {
  if (!options.dataDir) {
    logFile = null;
    return;
  }
  const file = path.join(options.dataDir, 'logs', 'vibe-pm.log');
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    logFile = file;
  } catch {
    // Diagnostics must never break plugin startup — fall back to console only.
    logFile = null;
  }
}

export function setLogEnabled(v: boolean): void {
  enabled = v;
}

// ─── Internal Utilities ───

/**
 * Extract the calling file's name (without path or extension) from Error.stack.
 * Skips logger.ts's own frames.
 */
function getCallerFile(): string {
  const orig = Error.prepareStackTrace;
  try {
    const err = new Error();
    Error.prepareStackTrace = (_, stack) => stack;
    const stack = (err as unknown as { stack: NodeJS.CallSite[] }).stack;
    Error.prepareStackTrace = orig;

    for (let i = 2; i < stack.length; i++) {
      const fn = stack[i]?.getFileName();
      if (fn && !fn.includes('/logger.')) {
        const m = fn.match(/([^/\\]+)\.[tj]s$/);
        return m ? m[1] : fn;
      }
    }
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

function toExtra(data?: unknown): Record<string, unknown> | undefined {
  if (data === undefined || data === null) return undefined;
  if (data instanceof Error) {
    return { error: data.message, stack: data.stack };
  }
  if (typeof data === 'object') {
    return Object.fromEntries(
      Object.entries(data as Record<string, unknown>).filter(
        ([, v]) => v !== undefined && v !== null,
      ),
    );
  }
  return { detail: String(data) };
}

function formatExtra(data?: unknown): string {
  const extra = toExtra(data);
  if (!extra) return '';
  try {
    return ` ${JSON.stringify(extra)}`;
  } catch {
    return ` ${String(data)}`;
  }
}

// ─── Sinks ───

function emitToConsole(level: LogLevel, line: string, data?: unknown): void {
  const args: unknown[] = data === undefined ? [line] : [line, data];
  switch (level) {
    case 'DEBUG':
      console.debug(...args);
      break;
    case 'INFO':
      console.info(...args);
      break;
    case 'WARN':
      console.warn(...args);
      break;
    case 'ERROR':
      console.error(...args);
      break;
  }
}

/**
 * Append asynchronously so the hot context hook never blocks on disk I/O.
 * Any failure is swallowed — diagnostics must not affect the host.
 */
function appendToFile(line: string): void {
  const file = logFile;
  if (!file) return;
  fs.appendFile(file, `${new Date().toISOString()} ${line}\n`, (err) => {
    if (err) {
      // Intentionally ignored: a broken log sink must not surface as a plugin error.
    }
  });
}

// ─── Write ───

function write(level: LogLevel, message: unknown, data?: unknown): void {
  if (!enabled) return;

  const caller = getCallerFile();
  const msg = `[vibe-pm] ${level} ${caller} ${
    typeof message === 'string' ? message : String(message)
  }`;

  emitToConsole(level, msg, data);
  appendToFile(`${msg}${formatExtra(data)}`);
}

// ─── Logger Instance ───

export const logger: ILogger = {
  debug(...args: unknown[]) {
    write('DEBUG', args[0], args[1]);
  },
  info(...args: unknown[]) {
    write('INFO', args[0], args[1]);
  },
  warn(...args: unknown[]) {
    write('WARN', args[0], args[1]);
  },
  error(...args: unknown[]) {
    write('ERROR', args[0], args[1]);
  },
};

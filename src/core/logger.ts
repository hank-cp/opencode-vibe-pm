/**
 * Logging Utility
 *
 * Writes to the host log system via the OpenCode SDK's app.log().
 * Public interface unchanged: logger.debug / info / warn / error.
 */

import type { ILogger } from './types.js';

// ─── LogClient Minimal Interface ───

interface LogClient {
  app: {
    log(options: {
      body?: {
        service: string;
        level: 'debug' | 'info' | 'warn' | 'error';
        message: string;
        extra?: Record<string, unknown>;
      };
    }): Promise<unknown>;
  };
}

// ─── State ───

let client: LogClient | null = null;
let enabled = true;

export function initLogger(c: LogClient): void {
  client = c;
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

// ─── Write ───

async function write(level: string, message: unknown, data?: unknown): Promise<void> {
  if (!enabled || !client) return;

  try {
    const service = getCallerFile();
    const msg = '[vibe-pm] ' + (typeof message === 'string' ? message : String(message));

    await client.app.log({
      body: {
        service,
        level: level.toLowerCase() as 'debug' | 'info' | 'warn' | 'error',
        message: msg,
        extra: toExtra(data),
      },
    });
  } catch {
    // Silent failure — logging should not crash the application
  }
}

// ─── Logger Instance ───

export const logger: ILogger = {
  debug(...args: unknown[]) {
    void write('DEBUG', args[0], args[1]);
  },
  info(...args: unknown[]) {
    void write('INFO', args[0], args[1]);
  },
  warn(...args: unknown[]) {
    void write('WARN', args[0], args[1]);
  },
  error(...args: unknown[]) {
    void write('ERROR', args[0], args[1]);
  },
};

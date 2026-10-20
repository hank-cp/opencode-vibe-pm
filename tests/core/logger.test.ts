/**
 * Logger Utility Tests
 *
 * V2 removed `client.app.log()`, so the logger writes to the host console
 * (`console.debug/info/warn/error`) and, when a data directory is configured, to
 * `<dataDir>/logs/vibe-pm.log`. Tests spy on the console methods and inspect the
 * log file, which is the real V2 sink pair.
 *
 * Test file: tests/core/logger.test.ts
 */

import { describe, it, expect, spyOn, beforeEach, afterEach, type Mock } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { logger, initLogger, setLogEnabled } from '../../src/core/logger.js';

/** Console spies, restored after every test so other suites see real output. */
let spies: Mock<(...args: unknown[]) => void>[] = [];

function spyConsole() {
  spies = [
    spyOn(console, 'debug').mockImplementation(() => {}),
    spyOn(console, 'info').mockImplementation(() => {}),
    spyOn(console, 'warn').mockImplementation(() => {}),
    spyOn(console, 'error').mockImplementation(() => {}),
  ];
}

function consoleSpy(level: 'debug' | 'info' | 'warn' | 'error') {
  const index = { debug: 0, info: 1, warn: 2, error: 3 }[level];
  return spies[index]!;
}

/** Lines are `[vibe-pm] <LEVEL> <caller> <message>`; the caller frame differs per runtime. */
function consoleLine(spy: Mock<(...args: unknown[]) => void>, call = 0): string {
  return String(spy.mock.calls[call]?.[0] ?? '');
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The caller segment is a file stem, or the runtime's `[native code]` (which contains a space). */
function logLinePattern(level: string, message: string): RegExp {
  return new RegExp(`^\\[vibe-pm\\] ${level} .+ ${escapeRegex(message)}$`);
}

/** File lines are `<ISO timestamp> [vibe-pm] <LEVEL> <caller> <message>`. */
function fileLinePattern(level: string, message: string): RegExp {
  return new RegExp(`^\\S+ \\[vibe-pm\\] ${level} .+ ${escapeRegex(message)}$`);
}

function tempDataDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-pm-logger-'));
}

function logFilePath(dataDir: string): string {
  return path.join(dataDir, 'logs', 'vibe-pm.log');
}

/** File appends are asynchronous by design; wait for the line instead of racing it. */
async function waitForLogLine(dataDir: string, needle: string, timeoutMs = 1000): Promise<string> {
  const file = logFilePath(dataDir);
  const deadline = Date.now() + timeoutMs;
  let raw = '';
  while (Date.now() < deadline) {
    raw = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : '';
    if (raw.includes(needle)) return raw;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return raw;
}

beforeEach(() => {
  spyConsole();
  initLogger();
  setLogEnabled(true);
});

afterEach(() => {
  for (const spy of spies) spy.mockRestore();
  spies = [];
  initLogger();
  setLogEnabled(true);
});

describe('logger', () => {
  it('logger_uninitialized_no_throw: calling uninitialized logger does not throw', () => {
    initLogger();

    expect(() => logger.info('test')).not.toThrow();
    expect(() => logger.error('test')).not.toThrow();
  });

  it('logger_disabled_no_call: setLogEnabled(false) suppresses calls', () => {
    setLogEnabled(false);

    logger.info('should not log');

    for (const level of ['debug', 'info', 'warn', 'error'] as const) {
      expect(consoleSpy(level)).not.toHaveBeenCalled();
    }
  });

  it('logger_re_enabled_calls: setLogEnabled(true) resumes calls', () => {
    setLogEnabled(false);
    setLogEnabled(true);

    logger.info('should log');

    expect(consoleSpy('info')).toHaveBeenCalledTimes(1);
  });

  it('logger_info_writes_console_line: info prefixes [vibe-pm] INFO and forwards data', () => {
    logger.info('hello world', { key: 'value' });

    const spy = consoleSpy('info');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(consoleLine(spy)).toMatch(logLinePattern('INFO', 'hello world'));
    // Structured data is handed to the host console untouched.
    expect(spy.mock.calls[0]?.[1]).toEqual({ key: 'value' });
  });

  it('logger_debug_warn_error_levels: routes each severity to its console method', () => {
    logger.debug('debug msg');
    logger.warn('warn msg');
    logger.error('error msg');

    expect(consoleSpy('debug')).toHaveBeenCalledTimes(1);
    expect(consoleSpy('warn')).toHaveBeenCalledTimes(1);
    expect(consoleSpy('error')).toHaveBeenCalledTimes(1);

    expect(consoleLine(consoleSpy('debug'))).toMatch(logLinePattern('DEBUG', 'debug msg'));
    expect(consoleLine(consoleSpy('warn'))).toMatch(logLinePattern('WARN', 'warn msg'));
    expect(consoleLine(consoleSpy('error'))).toMatch(logLinePattern('ERROR', 'error msg'));
  });

  it('logger_error_object_as_extra: Error object formatted as error/stack in the log file', async () => {
    const dataDir = tempDataDir();
    initLogger({ dataDir });

    logger.error('failed', new Error('test error'));

    // Console receives the raw error object so the host can render it natively.
    expect(consoleSpy('error').mock.calls[0]?.[1]).toBeInstanceOf(Error);

    const raw = await waitForLogLine(dataDir, '"error":"test error"');
    expect(raw).toContain('"error":"test error"');
    expect(raw).toContain('"stack":');

    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('logger_non_object_data_as_detail: non-object data placed in detail', async () => {
    const dataDir = tempDataDir();
    initLogger({ dataDir });

    logger.info('msg', 42);

    expect(consoleSpy('info').mock.calls[0]?.[1]).toBe(42);

    const raw = await waitForLogLine(dataDir, '{"detail":"42"}');
    expect(raw).toContain('{"detail":"42"}');

    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('logger_no_data_no_extra: no extra when no data provided', async () => {
    const dataDir = tempDataDir();
    initLogger({ dataDir });

    logger.info('msg only');

    const spy = consoleSpy('info');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]).toHaveLength(1);

    const raw = await waitForLogLine(dataDir, 'msg only');
    const line = raw.split('\n').find((l) => l.includes('msg only')) ?? '';
    expect(line.trimEnd()).toMatch(fileLinePattern('INFO', 'msg only'));

    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('logger_non_string_message: non-string message converted to string', () => {
    logger.info({ obj: 1 });

    expect(consoleLine(consoleSpy('info'))).toMatch(logLinePattern('INFO', '[object Object]'));
  });

  it('logger_appends_to_file: writes `<dataDir>/logs/vibe-pm.log` when a data dir is set', async () => {
    const dataDir = tempDataDir();
    initLogger({ dataDir });

    logger.info('file sink');

    const raw = await waitForLogLine(dataDir, 'file sink');
    expect(logFilePath(dataDir)).toContain(path.join('logs', 'vibe-pm.log'));
    expect(fs.existsSync(logFilePath(dataDir))).toBe(true);
    expect(raw).toMatch(new RegExp(fileLinePattern('INFO', 'file sink').source, 'm'));

    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('logger_disabled_skips_file: disabled logger writes neither console nor file', async () => {
    const dataDir = tempDataDir();
    initLogger({ dataDir });
    setLogEnabled(false);

    logger.info('suppressed line');

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fs.existsSync(logFilePath(dataDir))).toBe(false);

    fs.rmSync(dataDir, { recursive: true, force: true });
  });
});

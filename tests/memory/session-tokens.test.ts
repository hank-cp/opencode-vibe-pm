/**
 * Session Tokens CRUD Tests — SQLite tmp dir, each describe has independent MemorySystem
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { MemorySystem } from '../../src/memory';
import type { RecordSessionTokensInput } from '../../src/memory/types.js';
import { ApiTelemetry } from '../../src/token';

// ─── Helpers ─────────────────────────────────

/** Create MemorySystem and initialize in temp directory */
async function setupMemory(prefix: string): Promise<{ tmpDir: string; memory: MemorySystem }> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const memory = new MemorySystem();
  await memory.init(tmpDir);
  return { tmpDir, memory };
}

/** Clean up temp directory */
function teardownMemory(tmpDir: string): void {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

// ─── initSessionTokens ────────────────────────

describe('initSessionTokens', () => {
  let tmpDir: string;
  let memory: MemorySystem;

  beforeEach(async () => {
    const setup = await setupMemory('vibe-pm-test-ist-');
    tmpDir = setup.tmpDir;
    memory = setup.memory;
  });

  afterEach(() => {
    teardownMemory(tmpDir);
  });

  it('creates row with all zero counters', async () => {
    await memory.initSessionTokens('s1');
    const result = await memory.getSessionTokens('s1');

    expect(result).not.toBeNull();
    expect(result!.text).toBe(0);
    expect(result!.user).toBe(0);
    expect(result!.assistant).toBe(0);
    expect(result!.flowControl).toBe(0);
    expect(result!.tool).toBe(0);
    expect(result!.reasoning).toBe(0);
    expect(result!.apiInput).toBe(0);
    expect(result!.apiOutput).toBe(0);
    expect(result!.apiReasoning).toBe(0);
    expect(result!.apiCacheRead).toBe(0);
    expect(result!.apiCacheWrite).toBe(0);
    expect(result!.scaleFactor).toBe(1.0);
    expect(result!.startedAt).toBeDefined();
    expect(typeof result!.startedAt).toBe('string');
    expect(result!.updatedAt).toBeDefined();
    expect(typeof result!.updatedAt).toBe('string');
  });

  it('is idempotent (no error on re-init)', async () => {
    await memory.initSessionTokens('s1');
    // second call should not throw
    await expect(memory.initSessionTokens('s1')).resolves.toBeUndefined();
  });
});

// ─── recordSessionTokens ──────────────────────

describe('recordSessionTokens', () => {
  let tmpDir: string;
  let memory: MemorySystem;

  beforeEach(async () => {
    const setup = await setupMemory('vibe-pm-test-rst-');
    tmpDir = setup.tmpDir;
    memory = setup.memory;
  });

  afterEach(() => {
    teardownMemory(tmpDir);
  });

  const baseColumns: RecordSessionTokensInput = {
    text: 10,
    user: 20,
    assistant: 30,
    flowControl: 5,
    tool: 8,
    reasoning: 7,
  };

  it('accumulates columns correctly', async () => {
    await memory.initSessionTokens('s1');
    await memory.recordSessionTokens('s1', baseColumns);
    const result = await memory.getSessionTokens('s1');

    expect(result).not.toBeNull();
    expect(result!.text).toBe(10);
    expect(result!.user).toBe(20);
    expect(result!.assistant).toBe(30);
    expect(result!.flowControl).toBe(5);
    expect(result!.tool).toBe(8);
    expect(result!.reasoning).toBe(7);
  });

  it('auto-inits if row does not exist', async () => {
    // no prior init, directly record
    await memory.recordSessionTokens('s1', baseColumns);
    const result = await memory.getSessionTokens('s1');

    expect(result).not.toBeNull();
    expect(result!.text).toBe(10);
    expect(result!.user).toBe(20);
    expect(result!.assistant).toBe(30);
    expect(result!.flowControl).toBe(5);
    expect(result!.tool).toBe(8);
    expect(result!.reasoning).toBe(7);
  });

  it('accumulates across multiple calls', async () => {
    // plugin.ts passes full totals each call — INSERT OR REPLACE overwrites
    await memory.initSessionTokens('s1');
    await memory.recordSessionTokens('s1', baseColumns);
    const fullCall: RecordSessionTokensInput = {
      text: 15,
      user: 20,
      assistant: 30,
      flowControl: 5,
      tool: 8,
      reasoning: 7,
    };
    await memory.recordSessionTokens('s1', fullCall);
    const result = await memory.getSessionTokens('s1');

    expect(result).not.toBeNull();
    expect(result!.text).toBe(15);
  });

  it('updates updatedAt on each call', async () => {
    await memory.initSessionTokens('s1');
    const first = await memory.getSessionTokens('s1');

    // ensure time advances
    await new Promise((r) => setTimeout(r, 1));
    await memory.recordSessionTokens('s1', baseColumns);
    const second = await memory.getSessionTokens('s1');

    // updatedAt should be updated after record
    expect(second!.updatedAt).not.toBe(first!.updatedAt);
  });
});

// ─── recordSessionTokens with API telemetry ───

describe('recordSessionTokens with API telemetry', () => {
  let tmpDir: string;
  let memory: MemorySystem;

  beforeEach(async () => {
    const setup = await setupMemory('vibe-pm-test-apit-');
    tmpDir = setup.tmpDir;
    memory = setup.memory;
  });

  afterEach(() => {
    teardownMemory(tmpDir);
  });

  it('accumulates API fields', async () => {
    await memory.initSessionTokens('s1');

    const apiTelemetry: ApiTelemetry = {
      input: 100,
      output: 200,
      reasoning: 50,
      cache: { read: 25, write: 0 },
    };
    await memory.recordSessionTokens(
      's1',
      { text: 0, user: 0, assistant: 0, flowControl: 0, tool: 0, reasoning: 0 },
      apiTelemetry,
    );
    const result = await memory.getSessionTokens('s1');

    expect(result).not.toBeNull();
    expect(result!.apiInput).toBe(100);
    expect(result!.apiOutput).toBe(200);
    expect(result!.apiReasoning).toBe(50);
    expect(result!.apiCacheRead).toBe(25);
    expect(result!.apiCacheWrite).toBe(0);
  });

  it('calculates scaleFactor correctly', async () => {
    await memory.initSessionTokens('s1');

    const columns: RecordSessionTokensInput = {
      text: 200,
      user: 300,
      assistant: 500,
      flowControl: 0,
      tool: 0,
      reasoning: 0,
    };
    const apiTelemetry: ApiTelemetry = {
      input: 800,
      output: 600,
      reasoning: 0,
      cache: { read: 200, write: 0 },
    };
    await memory.recordSessionTokens('s1', columns, apiTelemetry);
    const result = await memory.getSessionTokens('s1');

    // scaleFactor = (apiInput + apiCacheRead + apiCacheWrite) / (system + user + assistant)
    //             = (800 + 200 + 0) / (200 + 300 + 500) = 1000 / 1000 = 1.0
    expect(result).not.toBeNull();
    expect(result!.scaleFactor).toBe(1.0);
  });

  it('scaleFactor remains 1.0 when denominator is zero', async () => {
    await memory.initSessionTokens('s1');

    const columns: RecordSessionTokensInput = {
      text: 0,
      user: 0,
      assistant: 0,
      flowControl: 0,
      tool: 0,
      reasoning: 0,
    };
    const apiTelemetry: ApiTelemetry = {
      input: 100,
      output: 50,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    };
    await memory.recordSessionTokens('s1', columns, apiTelemetry);
    const result = await memory.getSessionTokens('s1');

    // denominator = system+user+assistant = 0 → scaleFactor stays default 1.0
    expect(result).not.toBeNull();
    expect(result!.scaleFactor).toBe(1.0);
  });
});

// ─── getSessionTokens ─────────────────────────

describe('getSessionTokens', () => {
  let tmpDir: string;
  let memory: MemorySystem;

  beforeEach(async () => {
    const setup = await setupMemory('vibe-pm-test-gst-');
    tmpDir = setup.tmpDir;
    memory = setup.memory;
  });

  afterEach(() => {
    teardownMemory(tmpDir);
  });

  it('returns null for non-existent session', async () => {
    const result = await memory.getSessionTokens('nonexistent');
    expect(result).toBeNull();
  });

  it('returns correct values after write', async () => {
    await memory.initSessionTokens('s1');

    const columns: RecordSessionTokensInput = {
      text: 42,
      user: 7,
      assistant: 13,
      flowControl: 3,
      tool: 5,
      reasoning: 8,
    };
    const apiTelemetry: ApiTelemetry = {
      input: 200,
      output: 100,
      reasoning: 20,
      cache: { read: 10, write: 0 },
    };
    await memory.recordSessionTokens('s1', columns, apiTelemetry);
    const result = await memory.getSessionTokens('s1');

    expect(result).not.toBeNull();
    expect(result!.sessionId).toBe('s1');
    expect(result!.text).toBe(42);
    expect(result!.user).toBe(7);
    expect(result!.assistant).toBe(13);
    expect(result!.flowControl).toBe(3);
    expect(result!.tool).toBe(5);
    expect(result!.reasoning).toBe(8);
    expect(result!.apiInput).toBe(200);
    expect(result!.apiOutput).toBe(100);
    expect(result!.apiReasoning).toBe(20);
    expect(result!.apiCacheRead).toBe(10);
    expect(result!.apiCacheWrite).toBe(0);
    // scaleFactor = (input + cacheRead + cacheWrite) / (text + user + assistant)
    //             = (200+10+0)/(42+7+13) = 210/62 ≈ 3.387...
    expect(result!.scaleFactor).toBeCloseTo(210 / 62);
    expect(typeof result!.startedAt).toBe('string');
    expect(typeof result!.updatedAt).toBe('string');
  });
});

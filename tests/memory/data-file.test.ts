/**
 * Data File Tests — single SQLite file, whole file shares one MemorySystem
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { MemorySystem } from '../../src/memory/memory-system.js';

describe('Data File', () => {
  let tmpDir: string;
  let memory: MemorySystem;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-pm-test-df-'));
    memory = new MemorySystem();
    await memory.init(tmpDir);
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('init_creates_db_file_on_first_run: creates SQLite database file on first run', () => {
    const dbPath = path.join(tmpDir, 'vibe-pm.db');
    expect(fs.existsSync(dbPath)).toBe(true);
  });

  it('can_create_and_query_after_init: normal CRUD after init', async () => {
    const task = await memory.createTask({
      sessionId: 'ses_df_test',
      flow: 'test-flow',
      currentStep: 'S1',
      currentStepName: 'Test',
      startAt: new Date().toISOString(),
      summary: 'Verify usable after init',
    });
    expect(task.sessionId).toBe('ses_df_test');
    const fetched = await memory.getTask('ses_df_test');
    expect(fetched).toBeDefined();
  });
});

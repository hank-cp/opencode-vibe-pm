/**
 * Journal Manager Tests
 *
 * Covers journal file creation with header, incremental appends, automatic
 * directory creation, silent failure, and FIFO queue ordering — with a
 * mock SubsessionClient and a real MemorySystem (per project convention).
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { JournalManager } from '../../src/engine/journal-manager.js';
import { MemorySystem } from '../../src/memory/memory-system.js';
import type { SubsessionClient } from '../../src/engine/subsession-client.js';

const ENTRY_BASE = {
  taskId: 'task_j1',
  taskSummary: 'Test journal task',
  taskStartAt: '2026-08-20T00:00:00.000Z',
  flow: 'spec-driven-dev',
  sessionId: 'ses_main',
  transitionAt: '2026-08-20T01:00:00.000Z',
};

function createMockClient(outputs: string[]): SubsessionClient {
  return {
    async createSession() {
      return 'ses_journal_sub';
    },
    async prompt(_sessionId: string, _text: string, _tools: Record<string, boolean>) {
      const output = outputs.shift();
      if (output === undefined) throw new Error('no more mock outputs');
      return output;
    },
    async fetchRecentMessages() {
      return '--- assistant ---\nwork done';
    },
  };
}

describe('JournalManager', () => {
  let tmpDir: string;
  let memory: MemorySystem;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-pm-journal-'));
    memory = new MemorySystem();
    await memory.init(path.join(tmpDir, '.vibe-pm'));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates the journal file with a task header on first append', async () => {
    const manager = new JournalManager(createMockClient(['## briefing\nprogress ok']), tmpDir, memory);
    manager.scheduleEntry({ ...ENTRY_BASE, fromStep: '', toStep: 'S1', toStepName: 'Understand' });
    await manager.drain();

    const filePath = path.join(tmpDir, '.vibe-pm', 'journal', 'task_j1.md');
    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('# Task Journal');
    expect(content).toContain('- **Task ID**: task_j1');
    expect(content).toContain('- **Flow**: spec-driven-dev');
    expect(content).toContain('- **Summary**: Test journal task');
    expect(content).toContain('(start) → S1 (Understand)');
    expect(content).toContain('## briefing');

    const entries = await memory.getJournalEntries('task_j1');
    expect(entries).toHaveLength(1);
    expect(entries[0].fromStep).toBe('');
    expect(entries[0].toStep).toBe('S1');
    expect(entries[0].filePath).toBe(filePath);
  });

  it('appends incrementally for a second transition', async () => {
    const manager = new JournalManager(createMockClient(['second briefing']), tmpDir, memory);
    manager.scheduleEntry({ ...ENTRY_BASE, fromStep: 'S1', toStep: 'S2', toStepName: 'Design' });
    await manager.drain();

    const filePath = path.join(tmpDir, '.vibe-pm', 'journal', 'task_j1.md');
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('S1 → S2 (Design)');
    expect(content).toContain('second briefing');
    expect(content.split('# Task Journal').length).toBe(2);

    const entries = await memory.getJournalEntries('task_j1');
    expect(entries).toHaveLength(2);
  });

  it('degrades silently when prompting fails (no file, no throw)', async () => {
    const failingClient: SubsessionClient = {
      async createSession() {
        throw new Error('sub-session unavailable');
      },
      async prompt() {
        throw new Error('unreachable');
      },
      async fetchRecentMessages() {
        return '';
      },
    };
    const manager = new JournalManager(failingClient, tmpDir, memory);
    manager.scheduleEntry({ ...ENTRY_BASE, taskId: 'task_j_fail', fromStep: 'S1', toStep: 'S2', toStepName: 'X' });
    await manager.drain();

    expect(fs.existsSync(path.join(tmpDir, '.vibe-pm', 'journal', 'task_j_fail.md'))).toBe(false);
  });

  it('serializes queued entries in trigger order', async () => {
    const order: string[] = [];
    const client: SubsessionClient = {
      async createSession() {
        return 'ses_ordered';
      },
      async prompt() {
        order.push('prompt');
        await new Promise((r) => setTimeout(r, 30));
        return 'ok';
      },
      async fetchRecentMessages() {
        return '';
      },
    };
    const manager = new JournalManager(client, tmpDir, memory);
    manager.scheduleEntry({ ...ENTRY_BASE, taskId: 'task_order', fromStep: 'S1', toStep: 'S2', toStepName: 'A' });
    manager.scheduleEntry({ ...ENTRY_BASE, taskId: 'task_order', fromStep: 'S2', toStep: 'S3', toStepName: 'B' });
    await manager.drain();

    expect(order).toEqual(['prompt', 'prompt']);
    const filePath = path.join(tmpDir, '.vibe-pm', 'journal', 'task_order.md');
    const content = fs.readFileSync(filePath, 'utf-8');
    const firstIdx = content.indexOf('S1 → S2 (A)');
    const secondIdx = content.indexOf('S2 → S3 (B)');
    expect(firstIdx).toBeGreaterThan(-1);
    expect(secondIdx).toBeGreaterThan(firstIdx);

    const entries = await memory.getJournalEntries('task_order');
    expect(entries.map((e) => e.toStep)).toEqual(['S2', 'S3']);
  });
});

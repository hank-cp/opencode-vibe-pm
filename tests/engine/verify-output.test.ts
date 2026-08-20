/**
 * Verify Output Tests
 *
 * End-to-end behavior of FlowEngine.verifyOutput: no active task, legacy
 * 0.1 flow, 0.2 steps without review-agent, review-agent pass/fail with
 * rollback target resolution, degraded environments, and review persistence.
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { MemorySystem } from '../../src/memory/memory-system.js';
import { FlowEngine } from '../../src/engine/flow-engine.js';
import type { SubsessionClient } from '../../src/engine/subsession-client.js';

const FIXTURES = path.join(import.meta.dirname, 'fixtures');

const V2_FULL = 'v2-full';
const V1_LEGACY = 'v1-legacy';

const PASS_OUTPUT =
  '```json\n{"conclusion":"pass","feedback":"clean","nextInput":"proceed"}\n```';
const FAIL_DESIGN_OUTPUT =
  '```json\n{"conclusion":"fail","failReason":"Design problem","feedback":"redesign","nextInput":"go back"}\n```';
const FAIL_EXEC_OUTPUT =
  '```json\n{"conclusion":"fail","failReason":"Execution problem","feedback":"redo","nextInput":"retry"}\n```';

function createTestProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-pm-verify-'));
  const flowDir = path.join(dir, 'docs', 'flow');
  fs.mkdirSync(flowDir, { recursive: true });
  for (const name of [V2_FULL, V1_LEGACY]) {
    fs.copyFileSync(
      path.join(FIXTURES, `flow-${name}.md`),
      path.join(flowDir, `flow-${name}.md`),
    );
  }
  return dir;
}

function stubClient(output: string, fetchMessages: string): SubsessionClient {
  return {
    async createSession() {
      return 'ses_review_sub';
    },
    async prompt() {
      return output;
    },
    async fetchRecentMessages() {
      return fetchMessages;
    },
  };
}

describe('FlowEngine.verifyOutput', () => {
  let tmpDir: string;
  let memory: MemorySystem;

  beforeAll(async () => {
    tmpDir = createTestProject();
    memory = new MemorySystem();
    await memory.init(path.join(tmpDir, '.vibe-pm'));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function createEngine(client?: SubsessionClient): FlowEngine {
    return new FlowEngine(memory, tmpDir, client ? { subsessionClient: client } : undefined);
  }

  async function startAndStep(
    engine: FlowEngine,
    sessionId: string,
    flow: string,
    step: string,
  ): Promise<void> {
    await engine.startTask({
      sessionId,
      flow,
      summary: `verify test ${flow}`,
      userRequest: `verify test for ${flow}`,
    });
    const result = await engine.setStep(sessionId, step);
    expect(result.ok).toBe(true);
  }

  async function startAndReachS3(
    engine: FlowEngine,
    sessionId: string,
  ): Promise<void> {
    await engine.startTask({
      sessionId,
      flow: V2_FULL,
      summary: `verify test ${V2_FULL}`,
      userRequest: `verify test for ${V2_FULL}`,
    });
    for (const step of ['S1', 'S2', 'S3']) {
      const result = await engine.setStep(sessionId, step);
      expect(result.ok).toBe(true);
    }
  }

  it('errors when no active task exists', async () => {
    const engine = createEngine();
    const result = await engine.verifyOutput('ses_no_task');
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('returns a legacy notice for 0.1 flows', async () => {
    const engine = createEngine();
    await startAndStep(engine, 'ses_v1', V1_LEGACY, 'S1');
    const result = await engine.verifyOutput('ses_v1');
    expect(result.ok).toBe(true);
    expect(result.reviewRequired).toBe(false);
    expect(result.notice).toBeTruthy();
  });

  it('returns a no-review notice for 0.2 steps without review-agent', async () => {
    const engine = createEngine();
    await startAndStep(engine, 'ses_v2_s2', V2_FULL, 'S1');
    await engine.setStep('ses_v2_s2', 'S2');
    const result = await engine.verifyOutput('ses_v2_s2');
    expect(result.ok).toBe(true);
    expect(result.reviewRequired).toBe(false);
    expect(result.notice).toBeTruthy();
  });

  it('returns selfCheckChecklist for steps with self-check but no review-agent', async () => {
    const engine = createEngine();
    await startAndStep(engine, 'ses_v2_s2b', V2_FULL, 'S1');
    await engine.setStep('ses_v2_s2b', 'S2');
    const result = await engine.verifyOutput('ses_v2_s2b');
    expect(result.selfCheckChecklist).toEqual(['Covers all points', 'Follows project patterns']);
  });

  it('runs the review agent and returns pass for S3', async () => {
    const client = stubClient(PASS_OUTPUT, '--- assistant ---\nimplemented');
    const engine = createEngine(client);
    await startAndReachS3(engine, 'ses_pass');
    const result = await engine.verifyOutput('ses_pass');
    expect(result.ok).toBe(true);
    expect(result.reviewRequired).toBe(true);
    expect(result.conclusion).toBe('pass');
    expect(result.feedback).toBe('clean');
    expect(result.nextInput).toBe('proceed');
    expect(result.rollbackTarget).toBeUndefined();

    const reviews = await memory.getReviews((await memory.getActiveTask('ses_pass'))!.id);
    expect(reviews).toHaveLength(1);
    expect(reviews[0].conclusion).toBe('pass');
    expect(reviews[0].step).toBe('S3');
  });

  it('resolves rollback target per reason (design problem → S2)', async () => {
    const client = stubClient(FAIL_DESIGN_OUTPUT, '');
    const engine = createEngine(client);
    await startAndReachS3(engine, 'ses_fail_design');
    const result = await engine.verifyOutput('ses_fail_design');
    expect(result.conclusion).toBe('fail');
    expect(result.failReason).toBe('Design problem');
    expect(result.rollbackTarget).toBe('S2');
  });

  it('resolves execution problem rollback to the current step (self-loop)', async () => {
    const client = stubClient(FAIL_EXEC_OUTPUT, '');
    const engine = createEngine(client);
    await startAndReachS3(engine, 'ses_fail_exec');
    const result = await engine.verifyOutput('ses_fail_exec');
    expect(result.conclusion).toBe('fail');
    expect(result.failReason).toBe('Execution problem');
    expect(result.rollbackTarget).toBe('S3');
  });

  it('degraded fallback when the review agent output is unparseable', async () => {
    const client = stubClient('gibberish without json', '');
    const engine = createEngine(client);
    await startAndReachS3(engine, 'ses_parse_fail');
    const result = await engine.verifyOutput('ses_parse_fail');
    expect(result.conclusion).toBe('fail');
    expect(result.failReason).toBe('Execution problem');
    expect(result.rollbackTarget).toBe('S3');
  });

  it('returns a degraded notice when the host client is unavailable', async () => {
    const engine = createEngine();
    await startAndReachS3(engine, 'ses_no_client');
    const result = await engine.verifyOutput('ses_no_client');
    expect(result.ok).toBe(true);
    expect(result.reviewRequired).toBe(true);
    expect(result.conclusion).toBe('degraded');
    expect(result.notice).toBeTruthy();
  });

  it('schedules a journaler on setStep when a client is available', async () => {
    const client: SubsessionClient = {
      async createSession() {
        return 'ses_journal_sub';
      },
      async prompt() {
        return 'journal briefing';
      },
      async fetchRecentMessages() {
        return '--- assistant ---\nstep done';
      },
    };
    const engine = createEngine(client);
    await engine.startTask({
      sessionId: 'ses_journal_trigger',
      flow: V2_FULL,
      summary: 'journal trigger test',
      userRequest: 'journal trigger',
    });
    await engine.setStep('ses_journal_trigger', 'S1');

    await new Promise((r) => setTimeout(r, 50));
    const task = await memory.getActiveTask('ses_journal_trigger');
    const entries = await memory.getJournalEntries(task!.id);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0].toStep).toBe('S1');
    expect(
      fs.existsSync(path.join(tmpDir, '.vibe-pm', 'journal', `${task!.id}.md`)),
    ).toBe(true);
  });

  it('does not schedule a journaler when no client is available', async () => {
    const engine = createEngine();
    await engine.startTask({
      sessionId: 'ses_no_journal',
      flow: V2_FULL,
      summary: 'no journal test',
      userRequest: 'no journal',
    });
    await engine.setStep('ses_no_journal', 'S1');

    await new Promise((r) => setTimeout(r, 50));
    const task = await memory.getActiveTask('ses_no_journal');
    const entries = await memory.getJournalEntries(task!.id);
    expect(entries).toHaveLength(0);
  });
});

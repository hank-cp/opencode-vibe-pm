/**
 * Task CRUD Tests — SQLite tmp dir, whole file shares one MemorySystem
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { DuplicateTaskError, MemorySystem } from '../../src/memory';
import type { CreateTaskInput, StepTransition } from '../../src/memory/types.js';

describe('Task CRUD', () => {
  let tmpDir: string;
  let memory: MemorySystem;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-pm-test-task-'));
    memory = new MemorySystem();
    await memory.init(tmpDir);
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const baseTask = (suffix: string): CreateTaskInput => ({
    sessionId: `ses_${suffix}`,
    flow: 'project-build',
    currentStep: 'S1',
    currentStepName: 'Understand Requirements',
    startAt: new Date().toISOString(),
    summary: `Test task ${suffix}`,
  });

  it('create_and_get_task: returns full fields after creation', async () => {
    const created = await memory.createTask(baseTask('t001'));
    expect(created.sessionId).toBe('ses_t001');
    expect(created.closed).toBe(false);

    const fetched = await memory.getTask('ses_t001');
    expect(fetched).toBeDefined();
    expect(fetched!.sessionId).toBe('ses_t001');
  });

  it('getActiveTask_filters_closed: returns only unclosed tasks', async () => {
    await memory.createTask(baseTask('active'));
    const closedTask = await memory.createTask(baseTask('closed'));
    await memory.closeTask(closedTask.id);

    expect(await memory.getActiveTask('ses_active')).toBeDefined();
    expect(await memory.getActiveTask('ses_closed')).toBeNull();
  });

  it('updateStep_updates_both: syncs step number and name', async () => {
    const task = await memory.createTask(baseTask('step'));
    await memory.updateStep(task.id, 'S4', 'Design Solution');
    const updated = await memory.getTask(task.sessionId);
    expect(updated!.currentStep).toBe('S4');
    expect(updated!.currentStepName).toBe('Design Solution');
  });

  it('duplicate_task_rejected: same session cannot have two active tasks', async () => {
    await memory.createTask(baseTask('dup'));
    await expect(memory.createTask({ ...baseTask('dup'), summary: 'Second' })).rejects.toThrow(
      DuplicateTaskError,
    );
  });

  it('listActiveTasks: returns all unclosed tasks', async () => {
    await memory.createTask(baseTask('la'));
    await memory.createTask(baseTask('lb'));
    expect((await memory.listActiveTasks()).length).toBeGreaterThanOrEqual(2);
  });

  // ─── Metrics Extension ───────────────────────—

  it('closeTask_writes_endAt: writes end time on task close', async () => {
    const beforeClose = new Date().toISOString();
    const task = await memory.createTask(baseTask('endat'));
    await memory.closeTask(task.id);

    const closed = await memory.getTask('ses_endat');
    expect(closed).toBeDefined();
    expect(closed!.closed).toBe(true);
    expect(closed!.endAt).toBeDefined();
    expect(closed!.endAt! >= beforeClose).toBe(true);
  });

  it('recordStepEntry_with_tokensBySource: first entry creates record with source breakdown', async () => {
    const sid = 'ses_rse_crud';
    await memory.createTask(baseTask('rse_crud'));

    await memory.recordStepTokens(sid, 'project-build', 'S1', 'Understand Requirements', {
      text: 200,
      user: 100,
      assistant: 0,
      flowControl: 0,
      tool: 0,
      reasoning: 0,
    });

    const metrics = await memory.getStepTokenMetrics(sid);
    expect(metrics).toHaveLength(1);
    expect(metrics[0].tokensBySource).toEqual({ System: 200, User: 100 });
    expect(metrics[0].tokensConsumed).toBe(300);
    expect(metrics[0].stepInCount).toBe(1);
  });

  it('recordStepEntry_accumulates_tokensBySource: accumulates sources on repeat entries', async () => {
    const sid = 'ses_rse_acc_crud';
    await memory.createTask(baseTask('rse_acc_crud'));

    await memory.recordStepTokens(sid, 'project-build', 'S2', 'Implementation', {
      text: 50,
      user: 80,
      assistant: 0,
      flowControl: 0,
      tool: 0,
      reasoning: 0,
    });
    await memory.recordStepTokens(sid, 'project-build', 'S2', 'Implementation', {
      text: 30,
      user: 0,
      assistant: 120,
      flowControl: 0,
      tool: 0,
      reasoning: 0,
    });

    const metrics = await memory.getStepTokenMetrics(sid);
    expect(metrics).toHaveLength(1);
    expect(metrics[0].tokensBySource).toEqual({
      System: 80,
      User: 80,
      Assistant: 120,
    });
    expect(metrics[0].tokensConsumed).toBe(280);
    expect(metrics[0].stepInCount).toBe(1);
  });

  // ─── StepTransition ─────────────────────────────

  it('appendStepTransition_first: first append to task with no stepTransitions', async () => {
    const task = await memory.createTask(baseTask('tr0'));
    const transition: StepTransition = {
      fromStep: 'S1',
      toStep: 'S2',
      at: new Date().toISOString(),
    };
    await memory.appendStepTransition(task.id, transition);

    const updated = await memory.getTask('ses_tr0');
    expect(updated!.stepTransitions).toBeDefined();
    expect(updated!.stepTransitions).toHaveLength(1);
    expect(updated!.stepTransitions![0].fromStep).toBe('S1');
    expect(updated!.stepTransitions![0].toStep).toBe('S2');
  });

  it('appendStepTransition_append: multiple appends stored in order', async () => {
    const task = await memory.createTask(baseTask('tr1'));
    const t1: StepTransition = { fromStep: 'S1', toStep: 'S2', at: new Date().toISOString() };
    const t2: StepTransition = { fromStep: 'S2', toStep: 'S3', at: new Date().toISOString() };

    await memory.appendStepTransition(task.id, t1);
    await memory.appendStepTransition(task.id, t2);

    const updated = await memory.getTask('ses_tr1');
    expect(updated!.stepTransitions).toHaveLength(2);
    expect(updated!.stepTransitions![0].toStep).toBe('S2');
    expect(updated!.stepTransitions![1].toStep).toBe('S3');
  });
});

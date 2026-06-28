/**
 * MemorySystem 新增查询方法测试
 *
 * 测试 getLastClosedTask / getStepTokenBreakdown
 * 以及 closeTask 写入 endAt、recordStepEntry 累加 tokensBySource
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { MemorySystem } from '../../src/memory';
import type { CreateTaskInput } from '../../src/memory';

describe('Task Query Extensions', () => {
  let tmpDir: string;
  let memory: MemorySystem;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-pm-test-query-'));
    memory = new MemorySystem();
    await memory.init(tmpDir);
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const baseTask = (sessionId: string, flow = 'bug-fix'): CreateTaskInput => ({
    sessionId,
    flow,
    currentStep: 'S1',
    currentStepName: '理解需求',
    startAt: new Date().toISOString(),
    summary: `测试 ${sessionId}`,
  });

  // ─── getLastClosedTask ───────────────────────────

  describe('getLastClosedTask', () => {
    it('returns the most recently closed task by endAt', async () => {
      const sid = 'ses_lct';

      // 创建 3 个任务
      const t1 = await memory.createTask({ ...baseTask(sid), summary: 'Task 1' });
      const t2 = await memory.createTask({ ...baseTask(sid + '_2'), summary: 'Task 2' });
      const t3 = await memory.createTask({ ...baseTask(sid + '_3'), summary: 'Task 3' });

      // 逐个关闭（先关 t1 不行——同一 session 不能有两个活跃任务，
      // 所以需要不同 session）

      // t3 最先关闭
      await memory.closeTask(t3.id);
      // 稍等确保时间戳不同
      await new Promise((r) => setTimeout(r, 5));
      await memory.closeTask(t2.id);
      await new Promise((r) => setTimeout(r, 5));
      await memory.closeTask(t1.id);

      // t1（sid）是最晚关闭的
      const last = await memory.getLastClosedTask(sid);
      expect(last).toBeDefined();
      expect(last!.summary).toBe('Task 1');
      expect(last!.endAt).toBeDefined();
    });

    it('returns null when no tasks have been closed', async () => {
      const result = await memory.getLastClosedTask('ses_nonexistent');
      expect(result).toBeNull();
    });

    it('returns null for session with only active tasks', async () => {
      await memory.createTask(baseTask('ses_active_only'));
      const result = await memory.getLastClosedTask('ses_active_only');
      expect(result).toBeNull();
    });
  });

  // ─── closeTask writes endAt ─────────────────────

  describe('closeTask writes endAt', () => {
    it('sets endAt to a current timestamp on close', async () => {
      const beforeClose = new Date().toISOString();
      const task = await memory.createTask(baseTask('ses_endat'));
      await memory.closeTask(task.id);

      const closed = await memory.getTask('ses_endat');
      expect(closed).toBeDefined();
      expect(closed!.closed).toBe(true);
      expect(closed!.endAt).toBeDefined();
      expect(closed!.endAt! >= beforeClose).toBe(true);
    });
  });

  // ─── recordStepEntry with tokensBySource ────────

  describe('recordStepEntry with tokensBySource', () => {
    it('creates new record with tokensBySource', async () => {
      // 先创建任务以便 recordStepEntry 能关联 taskSummary
      await memory.createTask(baseTask('ses_rse_new'));

      await memory.recordStepTokens('ses_rse_new', 'bug-fix', 'S1', '理解需求', {
        text: 500,
        user: 300,
        assistant: 0,
        flowControl: 0,
        tool: 0,
        reasoning: 0,
      });

      const metrics = await memory.getStepTokenMetrics('ses_rse_new');
      expect(metrics).toHaveLength(1);
      expect(metrics[0].tokensBySource).toEqual({ System: 500, User: 300 });
      expect(metrics[0].tokensConsumed).toBe(800);
      expect(metrics[0].stepInCount).toBe(1);
    });

    it('accumulates tokensBySource on repeated entries', async () => {
      await memory.createTask(baseTask('ses_rse_acc'));

      await memory.recordStepTokens('ses_rse_acc', 'bug-fix', 'S1', '理解需求', {
        text: 100,
        user: 200,
        assistant: 0,
        flowControl: 0,
        tool: 0,
        reasoning: 0,
      });

      await memory.recordStepTokens('ses_rse_acc', 'bug-fix', 'S1', '理解需求', {
        text: 50,
        user: 0,
        assistant: 100,
        flowControl: 0,
        tool: 0,
        reasoning: 0,
      });

      const metrics = await memory.getStepTokenMetrics('ses_rse_acc');
      expect(metrics).toHaveLength(1);
      expect(metrics[0].tokensBySource).toEqual({
        System: 150,
        User: 200,
        Assistant: 100,
      });
      expect(metrics[0].tokensConsumed).toBe(450);
      expect(metrics[0].stepInCount).toBe(1);
    });
  });

  // ─── getStepTokenBreakdown ──────────────────────

  describe('getStepTokenBreakdown', () => {
    it('returns per-step token summary', async () => {
      const sid = 'ses_stpbd';

      await memory.createTask(baseTask(sid));

      await memory.recordStepTokens(sid, 'bug-fix', 'S1', '理解需求', {
        text: 100,
        user: 0,
        assistant: 0,
        flowControl: 0,
        tool: 0,
        reasoning: 0,
      });
      await memory.recordStepTokens(sid, 'bug-fix', 'S2', '设计方案', {
        text: 0,
        user: 0,
        assistant: 200,
        flowControl: 0,
        tool: 0,
        reasoning: 0,
      });
      await memory.recordStepTokens(sid, 'bug-fix', 'S2', '设计方案', {
        text: 0,
        user: 0,
        assistant: 50,
        flowControl: 0,
        tool: 0,
        reasoning: 0,
      });

      const breakdown = await memory.getStepTokenBreakdown(sid);
      expect(breakdown).toHaveLength(2);

      const s1 = breakdown.find((b) => b.step === 'S1');
      expect(s1).toBeDefined();
      expect(s1!.stepName).toBe('理解需求');
      expect(s1!.stepInCount).toBe(1);
      expect(s1!.tokensConsumed).toBe(100);

      const s2 = breakdown.find((b) => b.step === 'S2');
      expect(s2).toBeDefined();
      expect(s2!.stepName).toBe('设计方案');
      expect(s2!.stepInCount).toBe(1);
      expect(s2!.tokensConsumed).toBe(250);
    });
  });
});

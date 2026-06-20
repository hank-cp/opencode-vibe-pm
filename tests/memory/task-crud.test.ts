/**
 * Task CRUD 测试 — SQLite :memory:，整个文件共享 MemorySystem
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { MemorySystem } from "../../src/memory/memory-system.js";
import { DuplicateTaskError } from "../../src/memory/errors.js";
import type { CreateTaskInput, StepTransition } from "../../src/memory/types.js";

describe("Task CRUD", () => {
  let tmpDir: string;
  let memory: MemorySystem;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-pm-test-task-"));
    memory = new MemorySystem();
    await memory.init(tmpDir);
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const baseTask = (suffix: string): CreateTaskInput => ({
    sessionId: `ses_${suffix}`,
    flow: "project-build",
    currentStep: "S1",
    currentStepName: "理解需求",
    startAt: new Date().toISOString(),
    summary: `测试任务 ${suffix}`,
  });

  it("create_and_get_task: 创建后查询返回完整字段", async () => {
    const created = await memory.createTask(baseTask("t001"));
    expect(created.sessionId).toBe("ses_t001");
    expect(created.closed).toBe(false);

    const fetched = await memory.getTask("ses_t001");
    expect(fetched).toBeDefined();
    expect(fetched!.sessionId).toBe("ses_t001");
  });

  it("getActiveTask_filters_closed: 只返回未关闭的任务", async () => {
    await memory.createTask(baseTask("active"));
    const closedTask = await memory.createTask(baseTask("closed"));
    await memory.closeTask(closedTask.id);

    expect(await memory.getActiveTask("ses_active")).toBeDefined();
    expect(await memory.getActiveTask("ses_closed")).toBeNull();
  });

  it("updateStep_updates_both: 同步更新步骤编号和名称", async () => {
    const task = await memory.createTask(baseTask("step"));
    await memory.updateStep(task.id, "S4", "设计方案");
    const updated = await memory.getTask(task.sessionId);
    expect(updated!.currentStep).toBe("S4");
    expect(updated!.currentStepName).toBe("设计方案");
  });

  it("duplicate_task_rejected: 同一 session 不能有两个活跃任务", async () => {
    await memory.createTask(baseTask("dup"));
    await expect(
      memory.createTask({ ...baseTask("dup"), summary: "第二个" }),
    ).rejects.toThrow(DuplicateTaskError);
  });

  it("listActiveTasks: 返回所有未关闭的任务", async () => {
    await memory.createTask(baseTask("la"));
    await memory.createTask(baseTask("lb"));
    expect((await memory.listActiveTasks()).length).toBeGreaterThanOrEqual(2);
  });

  // ─── Metrics 扩展 ───────────────────────────────

  it("closeTask_writes_endAt: 关闭任务时写入结束时间", async () => {
    const beforeClose = new Date().toISOString();
    const task = await memory.createTask(baseTask("endat"));
    await memory.closeTask(task.id);

    const closed = await memory.getTask("ses_endat");
    expect(closed).toBeDefined();
    expect(closed!.closed).toBe(true);
    expect(closed!.endAt).toBeDefined();
    expect(closed!.endAt! >= beforeClose).toBe(true);
  });

  it("recordStepEntry_with_tokensBySource: 首次录入创建带来源分布的记录", async () => {
    const sid = "ses_rse_crud";
    await memory.createTask(baseTask("rse_crud"));

    await memory.recordStepEntry(sid, "project-build", "S1", "理解需求", {
      System: 200,
      User: 100,
    });

    const metrics = await memory.getFlowMetrics(sid);
    expect(metrics).toHaveLength(1);
    expect(metrics[0].tokensBySource).toEqual({ System: 200, User: 100 });
    expect(metrics[0].tokensConsumed).toBe(300);
    expect(metrics[0].userInputTokens).toBe(100);
    expect(metrics[0].stepInCount).toBe(1);
  });

  it("recordStepEntry_accumulates_tokensBySource: 重复录入时累加各项来源", async () => {
    const sid = "ses_rse_acc_crud";
    await memory.createTask(baseTask("rse_acc_crud"));

    await memory.recordStepEntry(sid, "project-build", "S2", "实现", {
      System: 50,
      User: 80,
    });
    await memory.recordStepEntry(sid, "project-build", "S2", "实现", {
      System: 30,
      Assistant: 120,
    });

    const metrics = await memory.getFlowMetrics(sid);
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

  it("appendStepTransition_first: 首次追加到无 stepTransitions 的任务", async () => {
    const task = await memory.createTask(baseTask("tr0"));
    const transition: StepTransition = {
      fromStep: "S1",
      toStep: "S2",
      at: new Date().toISOString(),
    };
    await memory.appendStepTransition(task.id, transition);

    const updated = await memory.getTask("ses_tr0");
    expect(updated!.stepTransitions).toBeDefined();
    expect(updated!.stepTransitions).toHaveLength(1);
    expect(updated!.stepTransitions![0].fromStep).toBe("S1");
    expect(updated!.stepTransitions![0].toStep).toBe("S2");
  });

  it("appendStepTransition_append: 多次追加按顺序存储", async () => {
    const task = await memory.createTask(baseTask("tr1"));
    const t1: StepTransition = { fromStep: "S1", toStep: "S2", at: new Date().toISOString() };
    const t2: StepTransition = { fromStep: "S2", toStep: "S3", at: new Date().toISOString() };

    await memory.appendStepTransition(task.id, t1);
    await memory.appendStepTransition(task.id, t2);

    const updated = await memory.getTask("ses_tr1");
    expect(updated!.stepTransitions).toHaveLength(2);
    expect(updated!.stepTransitions![0].toStep).toBe("S2");
    expect(updated!.stepTransitions![1].toStep).toBe("S3");
  });
});

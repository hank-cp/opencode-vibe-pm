/**
 * Task CRUD 测试 — AxioDB 单实例，整个文件共享 MemorySystem
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { MemorySystem } from "../../src/memory/memory-system.js";
import { DuplicateTaskError } from "../../src/memory/errors.js";
import type { CreateTaskInput } from "../../src/memory/types.js";

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
    await memory.closeTask(closedTask.documentId);

    expect(await memory.getActiveTask("ses_active")).toBeDefined();
    expect(await memory.getActiveTask("ses_closed")).toBeNull();
  });

  it("updateStep_updates_both: 同步更新步骤编号和名称", async () => {
    const task = await memory.createTask(baseTask("step"));
    await memory.updateStep(task.documentId, "S4", "设计方案");
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
});

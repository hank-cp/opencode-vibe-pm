/**
 * 任务启动测试
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { MemorySystem } from "../../src/memory/memory-system.js";
import { FlowEngine } from "../../src/engine/flow-engine.js";
import { DuplicateActiveTaskError, FlowNotFoundError } from "../../src/engine/errors.js";
import type { PluginConfig } from "../../src/core/types.js";

const DEFAULT_CONFIG: PluginConfig = {
  language: "zh-CN",
  dataDir: ".vibe-pm",
  autoAnalyze: true,
  contextInjection: { maxStepTokens: 0, pruneIrrelevant: false },
};

function createTestProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-pm-test-ts-"));
  fs.mkdirSync(path.join(dir, "docs", "flow"), { recursive: true });
  fs.mkdirSync(path.join(dir, "docs", "regulation"), { recursive: true });
  fs.copyFileSync(
    path.join(process.cwd(), "docs", "flow", "test-flow.md"),
    path.join(dir, "docs", "flow", "test-flow.md"),
  );
  fs.copyFileSync(
    path.join(process.cwd(), "docs", "regulation", "constitution.md"),
    path.join(dir, "docs", "regulation", "constitution.md"),
  );
  return dir;
}

describe("Task Start", () => {
  let tmpDir: string;
  let memory: MemorySystem;
  let engine: FlowEngine;

  beforeAll(async () => {
    tmpDir = createTestProject();
    memory = new MemorySystem();
    await memory.init(path.join(tmpDir, ".vibe-pm"));
    engine = new FlowEngine(memory, tmpDir, DEFAULT_CONFIG);
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("start_task_creates_successfully: 正常创建任务", async () => {
    const task = await engine.startTask({
      sessionId: "ses_new",
      flow: "test-flow",
      summary: "测试任务创建",
    });

    expect(task.sessionId).toBe("ses_new");
    expect(task.flow).toBe("test-flow");
    expect(task.currentStep).toBe("S1");
    expect(task.currentStepName).toContain("理解需求");
    expect(task.closed).toBe(false);
    expect(task.summary).toBe("测试任务创建");
  });

  it("start_task_rejects_duplicate: 重复任务阻止", async () => {
    await engine.startTask({
      sessionId: "ses_dup",
      flow: "test-flow",
      summary: "第一个任务",
    });

    await expect(
      engine.startTask({
        sessionId: "ses_dup",
        flow: "test-flow",
        summary: "第二个任务",
      }),
    ).rejects.toThrow(DuplicateActiveTaskError);
  });

  it("start_task_rejects_missing_flow: 不存在的 Flow 抛异常", async () => {
    await expect(
      engine.startTask({
        sessionId: "ses_missing",
        flow: "nonexistent",
        summary: "test",
      }),
    ).rejects.toThrow(FlowNotFoundError);
  });

  it("setStep_jumps_to_step: 手动跳转步骤", async () => {
    const task = await engine.startTask({
      sessionId: "ses_jump",
      flow: "test-flow",
      summary: "跳转测试",
    });

    await engine.setStep("ses_jump", "S3");

    const updated = await memory.getTask("ses_jump");
    expect(updated!.currentStep).toBe("S3");
    expect(updated!.currentStepName).toContain("审查");
  });
});

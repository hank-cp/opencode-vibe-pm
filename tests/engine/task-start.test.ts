/**
 * 任务启动测试
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { MemorySystem } from "../../src/memory/memory-system.js";
import { FlowEngine } from "../../src/engine/flow-engine.js";
import { FlowNotFoundError } from "../../src/engine/errors.js";
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
    engine = new FlowEngine(memory, tmpDir);
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
    expect(task.currentStep).toBe("");
    expect(task.currentStepName).toBe("");
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
    ).rejects.toThrow("already has active task");
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

  it("resolve_flow_from_command: 命令解析为 flow 名", async () => {
    const flowName = engine.resolveFlowFromCommand("pm-test");
    expect(flowName).toBe("test-flow");
  });

  it("resolve_flow_from_command_with_slash: 带 / 前缀的命令也能解析", () => {
    const flowName = engine.resolveFlowFromCommand("/pm-test");
    expect(flowName).toBe("test-flow");
  });

  it("resolve_unknown_command: 未知命令返回 null", () => {
    expect(engine.resolveFlowFromCommand("pm-unknown")).toBeNull();
  });

  it("resolve_unknown_command_with_slash: 带 / 前缀的未知命令返回 null", () => {
    expect(engine.resolveFlowFromCommand("/pm-unknown")).toBeNull();
  });

  // ─── setStep dwellTime ───────────────────────

  it("setStep_writes_stepTransitions: 从空步骤到 S2 写入转换记录", async () => {
    await engine.startTask({
      sessionId: "ses_tr_write",
      flow: "test-flow",
      summary: "transition 测试",
    });
    await engine.setStep("ses_tr_write", "S2");

    const task = await memory.getActiveTask("ses_tr_write");
    expect(task!.stepTransitions).toBeDefined();
    expect(task!.stepTransitions).toHaveLength(1);
    expect(task!.stepTransitions![0].fromStep).toBe("");
    expect(task!.stepTransitions![0].toStep).toBe("S2");
    expect(task!.stepTransitions![0].at).toBeDefined();
  });

  it("setStep_records_dwellTime_from_transitions: 从持久化记录计算停留时间", async () => {
    await engine.startTask({
      sessionId: "ses_dwell",
      flow: "test-flow",
      summary: "dwell 测试",
    });
    await engine.setStep("ses_dwell", "S2");

    await new Promise((r) => setTimeout(r, 15));
    await engine.setStep("ses_dwell", "S3");

    const metrics = await memory.getFlowMetrics("ses_dwell");
    const s2Metric = metrics.find((m) => m.step === "S2");
    expect(s2Metric).toBeDefined();
    expect(s2Metric!.dwellTime).toBeGreaterThan(0);
  });

  it("closeTask_records_final_dwellTime: 关闭任务时记录最后步骤停留时间", async () => {
    const task = await engine.closeTask("ses_dwell");
    expect(task).not.toBeNull();

    const metrics = await memory.getFlowMetrics("ses_dwell");
    const s3Metric = metrics.find((m) => m.step === "S3");
    expect(s3Metric).toBeDefined();
    expect(s3Metric!.dwellTime).toBeGreaterThanOrEqual(0);
  });

  it("closeTask_after_reinstantiation: 重启后 closeTask 正常工作", async () => {
    const engine2 = new FlowEngine(memory, tmpDir);
    await engine2.startTask({
      sessionId: "ses_res_close",
      flow: "test-flow",
      summary: "restart close 测试",
    });
    const closed = await engine2.closeTask("ses_res_close");
    expect(closed).not.toBeNull();
    expect(closed!.closed).toBe(true);
    expect(closed!.flow).toBe("test-flow");
  });

  it("setStep_after_reinstantiation: 重启后 setStep 正常工作", async () => {
    const engine2 = new FlowEngine(memory, tmpDir);
    await engine2.startTask({
      sessionId: "ses_res_step",
      flow: "test-flow",
      summary: "restart step 测试",
    });
    await engine2.setStep("ses_res_step", "S2");
    const engine3 = new FlowEngine(memory, tmpDir);
    await engine3.setStep("ses_res_step", "S3");
    const updated = await memory.getActiveTask("ses_res_step");
    expect(updated!.currentStep).toBe("S3");
    expect(updated!.stepTransitions).toHaveLength(2);
  });
});


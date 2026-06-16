/**
 * 任务启动测试
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
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
    expect(task.currentStep).toBe("S1");
    expect(task.currentStepName).toBe("就绪");
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
});

describe("buildControlPrompt", () => {
  const engine = new FlowEngine(
    new MemorySystem(),
    "/fake/project",
  );

  it("constitution_is_supreme_rule: constitution 为最高优先级", () => {
    const prompt = engine.buildControlPrompt("bug-fix");
    expect(prompt).toContain("constitution.md（最高）");
    expect(prompt).toContain("任何规则与 constitution 冲突时");
    expect(prompt).toContain("以 constitution 为准");
  });

  it("contains_priority_hierarchy: 包含三级优先级体系", () => {
    const prompt = engine.buildControlPrompt("bug-fix");
    expect(prompt).toContain("优先级");
    expect(prompt).toContain("constitution.md");
    expect(prompt).toContain("本流程执行规则");
    expect(prompt).toContain("其他指令");
  });

  it("contains_mode_conflict_handling: 处理 analyze-mode 冲突", () => {
    const prompt = engine.buildControlPrompt("bug-fix");
    expect(prompt).toContain("analyze-mode");
    expect(prompt).toContain("CONTEXT GATHERING");
    expect(prompt).toContain("S1 步骤");
  });

  it("contains_startup_sequence: 启动序列以 constitution 为先", () => {
    const prompt = engine.buildControlPrompt("bug-fix");
    expect(prompt).toContain("constitution.md");
    expect(prompt).toContain("FSM 状态图");
    expect(prompt).toContain("进入执行循环");
    const startupSection = prompt.split("## 执行循环")[0];
    expect(startupSection).not.toContain("pm_task_start");
    expect(startupSection).not.toContain("pm_task_set_step");
  });

  it("contains_execution_loop: 包含执行循环（含 pm_task_set_step）", () => {
    const prompt = engine.buildControlPrompt("bug-fix");
    expect(prompt).toContain("S{n}");
    expect(prompt).toContain("pm_task_set_step");
    expect(prompt).toContain("⚠️ 标记");
    expect(prompt).toContain("question/confirm");
  });

  it("contains_all_red_lines: 包含全部 8 条红线", () => {
    const prompt = engine.buildControlPrompt("bug-fix");
    expect(prompt).toMatch(/未读.*constitution.*就开始/);
    expect(prompt).toMatch(/S1.*阶段.*编辑/);
    expect(prompt).toContain("把用户请求直接当成编码任务");
    expect(prompt).toContain("不调用 question/confirm 就直接执行");
    expect(prompt).toContain("跳步");
    expect(prompt).toContain("预读全流程后直奔编码步骤");
    expect(prompt).toMatch(/创建 todo.*流程步骤/);
    expect(prompt).toMatch(/行为与.*constitution.*冲突/);
  });

  it("contains_step_gates: 包含步骤门禁表", () => {
    const prompt = engine.buildControlPrompt("bug-fix");
    expect(prompt).toContain("S1（理解）");
    expect(prompt).toContain("编辑/创建/删除文件");
    expect(prompt).toContain("带 ⚠️");
    expect(prompt).toContain("合流");
  });

  it("contains_flow_reference: 包含正确的 flow 文件引用", () => {
    const prompt = engine.buildControlPrompt("bug-fix");
    expect(prompt).toContain("docs/flow/[flow]bug-fix.md");
  });

  it("wraps_in_pm_control_rules_tags: 使用 pm-control-rules 标签包裹", () => {
    const prompt = engine.buildControlPrompt("bug-fix");
    expect(prompt).toMatch(/^<pm-control-rules>/);
    expect(prompt).toMatch(/<\/pm-control-rules>$/);
  });

  it("prompt_mentions_flow_execution_failure_consequence: 提示词提及流程执行失败的后果", () => {
    const prompt = engine.buildControlPrompt("bug-fix");
    expect(prompt).toContain("红线");
    expect(prompt).toContain("流程执行失败");
  });
});

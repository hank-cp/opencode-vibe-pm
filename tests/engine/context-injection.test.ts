/**
 * 上下文注入测试
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { MemorySystem } from "../../src/memory/memory-system.js";
import { FlowEngine } from "../../src/engine/flow-engine.js";
import type { PluginConfig } from "../../src/core/types.js";

const DEFAULT_CONFIG: PluginConfig = {
  language: "zh-CN",
  dataDir: ".vibe-pm",
  autoAnalyze: true,
  contextInjection: { maxStepTokens: 0, pruneIrrelevant: false },
};

function createTestProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-pm-test-ci-"));
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
  fs.copyFileSync(
    path.join(process.cwd(), "docs", "regulation", "coding_style.md"),
    path.join(dir, "docs", "regulation", "coding_style.md"),
  );
  return dir;
}

describe("Context Injection", () => {
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

  it("inject_prefix_fixed_with_step_dynamic: 含固定前缀 + 步骤动态", async () => {
    await engine.startTask({
      sessionId: "ses_ci1",
      flow: "test-flow",
      summary: "注入测试",
    });

    const input = { sessionID: "ses_ci1" };
    const output = { system: [] as string[] };

    await engine.injectContext(input, output);

    const fullSystem = output.system.join("\n");
    // 固定前缀：Constitution + Flow 全文 + 控制 Prompt
    expect(fullSystem).toContain("<constitution>");
    expect(fullSystem).toContain("<flow-document");
    expect(fullSystem).toContain("<flow-control>");
    // 步骤动态：当前步骤 + Task 状态
    expect(fullSystem).toContain("<current-step");
    expect(fullSystem).toContain("<task-state>");
  });

  it("inject_full_flow_document: Flow 文档全量注入包含所有步骤", async () => {
    await engine.startTask({
      sessionId: "ses_full",
      flow: "test-flow",
      summary: "全量注入测试",
    });

    const input = { sessionID: "ses_full" };
    const output = { system: [] as string[] };

    await engine.injectContext(input, output);

    // Flow 文档全文注入 → 应包含所有步骤名称
    const fullSystem = output.system.join("\n");
    expect(fullSystem).toContain("S1: 理解需求");
    expect(fullSystem).toContain("S2: 设计方案");
    expect(fullSystem).toContain("S3:");
    expect(fullSystem).toContain("S4: 实现");
    // 同时包含 Mermaid FSM 图（在完整 Flow 文档内）
    expect(fullSystem).toContain("stateDiagram");
  });

  it("no_inject_without_task_or_pending: 无活跃任务且无 pending 时不修改输出", async () => {
    const input = { sessionID: "ses_noop" };
    const output = { system: ["original"] };

    await engine.injectContext(input, output);

    expect(output.system).toEqual(["original"]);
  });

  it("inject_from_pending_without_task: 无任务但有 pending flow 时注入上下文", async () => {
    const sessionId = "ses_pending";
    // 模拟 command.execute.before 设置了 pending
    (engine as any).pendingFlowInjects.set(sessionId, "test-flow");

    const output = { system: ["original"] };
    await engine.injectContext({ sessionID: sessionId }, output);

    // 应有注入内容（前缀固定 + 步骤动态）
    const fullSystem = output.system.join("\n");
    expect(fullSystem).toContain("<constitution>");
    expect(fullSystem).toContain("<flow-document");
    expect(fullSystem).toContain("<flow-control>");
    expect(fullSystem).toContain("S1");
    expect(fullSystem).toContain("<step-reminder>");

    // pending 不会在 injectContext 中消费，留给 transformMessages 处理
    expect((engine as any).pendingFlowInjects.has(sessionId)).toBe(true);

    // 手动清理
    (engine as any).pendingFlowInjects.delete(sessionId);
  });

  it("no_inject_without_session: 无 sessionID 不注入", async () => {
    const input = {};
    const output = { system: ["original"] };

    await engine.injectContext(input, output);

    expect(output.system).toEqual(["original"]);
  });

  it("inject_regulation_conditional: Regulation 按条件注入", async () => {
    // S1 (理解需求) 无 regulation 引用 → 不应注入 regulation
    await engine.startTask({
      sessionId: "ses_reg1",
      flow: "test-flow",
      summary: "Regulation 条件测试 S1",
    });

    const output1 = { system: [] as string[] };
    await engine.injectContext({ sessionID: "ses_reg1" }, output1);
    const sys1 = output1.system.join("\n");
    expect(sys1).not.toContain("<regulation>");

    // 推进到 S2 (设计方案)，引用 coding_style.md
    await engine.setStep("ses_reg1", "S2");

    const output2 = { system: [] as string[] };
    await engine.injectContext({ sessionID: "ses_reg1" }, output2);
    const sys2 = output2.system.join("\n");
    expect(sys2).toContain("<regulation>");
    // coding_style.md 内容应在 regulation 标签内
    expect(sys2).toContain("TypeScript");
  });

  it("inject_control_prompt_split: 控制 Prompt 静态纪律在固定前缀中", async () => {
    await engine.startTask({
      sessionId: "ses_ctrl",
      flow: "test-flow",
      summary: "控制 Prompt 分离测试",
    });

    const output = { system: [] as string[] };
    await engine.injectContext({ sessionID: "ses_ctrl" }, output);

    const fullSystem = output.system.join("\n");

    // 静态纪律在固定前缀的 <flow-control> 中
    const flowControlIdx = fullSystem.indexOf("<flow-control>");

    // 当前步骤信息在 <current-step> 中（步骤动态）
    const currentStepIdx = fullSystem.indexOf("<current-step");

    // 固定前缀应在步骤动态之前
    expect(flowControlIdx).toBeLessThan(currentStepIdx);

    // 静态纪律内容：FLOW MANDATE, NEVER skip, NEVER bypass
    const prefixSection = fullSystem.substring(0, currentStepIdx);
    expect(prefixSection).toContain("FLOW MANDATE");
    expect(prefixSection).toContain("NEVER");
    expect(prefixSection).toContain("skip ahead");
    expect(prefixSection).toContain("bypass Human-in-loop");

    // 步骤动态内容：当前步骤、完成后
    const dynamicSection = fullSystem.substring(currentStepIdx);
    expect(dynamicSection).toContain("当前步骤");
    expect(dynamicSection).toContain("完成后");
  });
});

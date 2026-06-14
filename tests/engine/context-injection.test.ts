/**
 * 上下文注入测试（简化版：Session 级一次性注入）
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

  it("inject_session_level_context: 活跃任务时注入 session 级别上下文", async () => {
    await engine.startTask({
      sessionId: "ses_ci1",
      flow: "test-flow",
      summary: "注入测试",
    });

    const input = { sessionID: "ses_ci1" };
    const output = { system: [] as string[] };

    await engine.injectContext(input, output);

    const fullSystem = output.system.join("\n");
    expect(fullSystem).toContain("<constitution>");
    expect(fullSystem).toContain("<flow-document");
    expect(fullSystem).toContain("<flow-control>");
    expect(fullSystem).toContain("<task-state>");
    // 不再有步骤动态内容
    expect(fullSystem).not.toContain("<current-step");
  });

  it("inject_full_flow_document: Flow 文档全文注入包含所有步骤", async () => {
    await engine.startTask({
      sessionId: "ses_full",
      flow: "test-flow",
      summary: "全量注入测试",
    });

    const input = { sessionID: "ses_full" };
    const output = { system: [] as string[] };

    await engine.injectContext(input, output);

    const fullSystem = output.system.join("\n");
    expect(fullSystem).toContain("S1: 理解需求");
    expect(fullSystem).toContain("S2: 设计方案");
    expect(fullSystem).toContain("S3:");
    expect(fullSystem).toContain("S4: 实现");
    expect(fullSystem).toContain("stateDiagram");
  });

  it("no_inject_without_task_or_pending: 无活跃任务且无 pending 时不修改输出", async () => {
    const input = { sessionID: "ses_noop2" };
    const output = { system: ["original"] };

    await engine.injectContext(input, output);

    expect(output.system).toEqual(["original"]);
  });

  it("inject_from_pending_without_task: 无任务但有 pending flow 时注入上下文", async () => {
    const sessionId = "ses_pending2";
    (engine as any).pendingFlowInjects.set(sessionId, "test-flow");

    const output = { system: ["original"] };
    await engine.injectContext({ sessionID: sessionId }, output);

    const fullSystem = output.system.join("\n");
    expect(fullSystem).toContain("<constitution>");
    expect(fullSystem).toContain("<flow-document");
    expect(fullSystem).toContain("<flow-control>");

    // pending 在 injectFlowFromPending 末尾被清理
    expect((engine as any).pendingFlowInjects.has(sessionId)).toBe(false);
  });

  it("no_inject_without_session: 无 sessionID 不注入", async () => {
    const input = {};
    const output = { system: ["original"] };

    await engine.injectContext(input, output);

    expect(output.system).toEqual(["original"]);
  });

  it("inject_session_dedup: 同一 session 只注入一次", async () => {
    await engine.startTask({
      sessionId: "ses_dedup",
      flow: "test-flow",
      summary: "去重测试",
    });

    // 第一次注入
    const output1 = { system: [] as string[] };
    await engine.injectContext({ sessionID: "ses_dedup" }, output1);
    const sys1 = output1.system.join("\n");
    expect(sys1).toContain("<flow-document");

    // 第二次注入 — 应被去重跳过
    const output2 = { system: ["original"] };
    await engine.injectContext({ sessionID: "ses_dedup" }, output2);
    expect(output2.system).toEqual(["original"]);
  });

  it("clear_session_inject_allows_reinject: 清除后可以重新注入", async () => {
    await engine.startTask({
      sessionId: "ses_clear",
      flow: "test-flow",
      summary: "清除后重新注入",
    });

    // 第一次注入
    const output1 = { system: [] as string[] };
    await engine.injectContext({ sessionID: "ses_clear" }, output1);
    expect(output1.system.join("\n")).toContain("<flow-document");

    // 清除注入记录
    engine.clearSessionInject("ses_clear");

    // 再次注入应该生效
    const output2 = { system: ["after-clear"] };
    await engine.injectContext({ sessionID: "ses_clear" }, output2);
    const sys2 = output2.system.join("\n");
    expect(sys2).toContain("<flow-document");
    expect(sys2).toContain("after-clear");
  });
});

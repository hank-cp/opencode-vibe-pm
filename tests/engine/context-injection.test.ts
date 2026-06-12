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

  it("inject_triple_layer: 含 Layer 1+2", async () => {
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
    expect(fullSystem).toContain("<fsm-diagram");
    expect(fullSystem).toContain("<step-overview>");
    expect(fullSystem).toContain("<current-step");
    expect(fullSystem).toContain("<task-state>");
    expect(fullSystem).toContain("<fsm-instructions>");
  });

  it("inject_layer3_when_non_hil: 非 HiL 步骤含 Layer 3 前瞻", async () => {
    await engine.startTask({
      sessionId: "ses_l3",
      flow: "test-flow",
      summary: "前瞻测试",
    });

    const input = { sessionID: "ses_l3" };
    const output = { system: [] as string[] };

    await engine.injectContext(input, output);

    // S1 是非 HiL, S2 也是 → 应有 Layer 3 前瞻
    const fullSystem = output.system.join("\n");
    expect(fullSystem).toContain("<lookahead-window>");
  });

  it("no_inject_without_task: 无活跃任务不注入", async () => {
    const input = { sessionID: "ses_noop" };
    const output = { system: ["original"] };

    await engine.injectContext(input, output);

    expect(output.system).toEqual(["original"]);
  });

  it("no_inject_without_session: 无 sessionID 不注入", async () => {
    const input = {};
    const output = { system: ["original"] };

    await engine.injectContext(input, output);

    expect(output.system).toEqual(["original"]);
  });
});

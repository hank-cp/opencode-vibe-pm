/**
 * Flow 文档解析测试
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-pm-test-fp-"));

  // 创建目录结构
  fs.mkdirSync(path.join(dir, "docs", "flow"), { recursive: true });
  fs.mkdirSync(path.join(dir, "docs", "regulation"), { recursive: true });

  // 复制 test-flow.md
  const srcFlow = path.join(process.cwd(), "docs", "flow", "test-flow.md");
  fs.copyFileSync(srcFlow, path.join(dir, "docs", "flow", "test-flow.md"));

  // 复制 constitution
  const srcConst = path.join(process.cwd(), "docs", "regulation", "constitution.md");
  fs.copyFileSync(srcConst, path.join(dir, "docs", "regulation", "constitution.md"));

  return dir;
}

describe("Flow Parser", () => {
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

  it("parse_complete_flow: 解析完整 Flow 文档", async () => {
    const flow = await engine.parseFlow("test-flow");

    expect(flow.name).toBe("test-flow");
    expect(flow.command).toBe("/pm-test");
    expect(flow.steps).toHaveLength(4);
    expect(flow.fsmDiagram).toBeTruthy();
    expect(flow.fsmDiagram).toContain("stateDiagram");
  });

  it("parse_steps_have_correct_fields: 步骤字段完整", async () => {
    const flow = await engine.parseFlow("test-flow");

    const s1 = flow.steps[0];
    expect(s1.id).toBe("S1");
    expect(s1.name).toContain("理解需求");
    expect(s1.goal).toBeTruthy();
    expect(s1.agent).toBeTruthy();
    expect(s1.instructions.length).toBeGreaterThan(0);
    expect(s1.humanInLoop).toBe(false);
    expect(s1.onComplete).toBeTruthy();
  });

  it("parse_hil_step: Human-in-loop 步骤正确标记", async () => {
    const flow = await engine.parseFlow("test-flow");

    const s3 = flow.steps[2];
    expect(s3.id).toBe("S3");
    expect(s3.humanInLoop).toBe(true);
  });

  it("parse_fsm_diagram: FSM 图正确提取", async () => {
    const flow = await engine.parseFlow("test-flow");

    expect(flow.fsmDiagram).toContain("S1");
    expect(flow.fsmDiagram).toContain("S2");
    expect(flow.fsmDiagram).toContain("S3");
    expect(flow.fsmDiagram).toContain("S4");
  });

  it("parse_missing_flow_throws: 不存在的 Flow 抛异常", async () => {
    await expect(engine.parseFlow("nonexistent")).rejects.toThrow(
      FlowNotFoundError,
    );
  });

  it("list_available_flows: 列出可用 Flow", async () => {
    const flows = await engine.listFlows();
    expect(flows).toContain("test-flow");
  });

  it("read_flow_content: 读取原始 Flow 内容", async () => {
    const content = await engine.readFlowContent("test-flow");
    expect(content).toContain("# Flow: test-flow");
    expect(content).toContain("stateDiagram-v2");
  });
});

/**
 * FlowMetrics CRUD 测试 — AxioDB 单实例，整个文件共享 MemorySystem
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { MemorySystem } from "../../src/memory/memory-system.js";

describe("FlowMetrics CRUD", () => {
  let tmpDir: string;
  let memory: MemorySystem;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-pm-test-fm-"));
    memory = new MemorySystem();
    await memory.init(tmpDir);
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("record_step_entry_and_exit: 完整记录进入和退出指标", async () => {
    await memory.recordStepEntry(
      "ses_e1", "project-build", "S3", "需求澄清访谈", 5000, 1200,
    );
    await memory.recordStepExit("ses_e1", "S3", 300000, 60000);

    const metrics = await memory.getFlowMetrics("ses_e1");
    expect(metrics).toHaveLength(1);
    const m = metrics[0];
    expect(m.step).toBe("S3");
    expect(m.stepName).toBe("需求澄清访谈");
    expect(m.stepInCount).toBe(1);
    expect(m.tokensConsumed).toBe(5000);
    expect(m.dwellTime).toBe(300000);
    expect(m.humanInterventionTime).toBe(60000);
  });

  it("step_in_count_increments: 重复进入同一步骤累加计数", async () => {
    await memory.recordStepEntry(
      "ses_inc", "project-build", "S4", "设计方案", 1000, 300,
    );
    await memory.recordStepEntry(
      "ses_inc", "project-build", "S4", "设计方案", 2000, 500,
    );

    const metrics = await memory.getFlowMetrics("ses_inc");
    expect(metrics).toHaveLength(1);
    expect(metrics[0].stepInCount).toBe(2);
    expect(metrics[0].tokensConsumed).toBe(3000);
    expect(metrics[0].userInputTokens).toBe(800);
  });

  it("get_metrics_by_flow_aggregates: 按流程聚合", async () => {
    await memory.recordStepEntry(
      "ses_pa", "project-build", "S1", "理解需求", 100, 50,
    );
    await memory.recordStepEntry(
      "ses_pb", "project-build", "S1", "理解需求", 200, 80,
    );
    await memory.recordStepEntry(
      "ses_of", "other-flow", "S2", "其他步骤", 300, 100,
    );

    const pb = await memory.getFlowMetricsByFlow("project-build");
    const myPb = pb.filter((m) => ["ses_pa", "ses_pb"].includes(m.sessionId));
    expect(myPb).toHaveLength(2);

    const of = await memory.getFlowMetricsByFlow("other-flow");
    expect(of).toHaveLength(1);
  });

  it("record_step_exit_accumulates: 多次退出累加 dwellTime", async () => {
    await memory.recordStepEntry(
      "ses_ex", "project-build", "S2", "标记缺口", 1000, 200,
    );
    await memory.recordStepExit("ses_ex", "S2", 10000, 5000);
    await memory.recordStepExit("ses_ex", "S2", 20000, 3000);

    const metrics = await memory.getFlowMetrics("ses_ex");
    expect(metrics[0].dwellTime).toBe(30000);
    expect(metrics[0].humanInterventionTime).toBe(8000);
  });
});

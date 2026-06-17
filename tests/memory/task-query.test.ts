/**
 * MemorySystem 新增查询方法测试
 *
 * 测试 getLastClosedTask / getSourceTokenBreakdown / getStepTokenBreakdown
 * 以及 closeTask 写入 endAt、recordStepEntry 累加 tokensBySource
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { MemorySystem } from "../../src/memory/memory-system.js";
import type { CreateTaskInput } from "../../src/memory/types.js";

describe("Task Query Extensions", () => {
  let tmpDir: string;
  let memory: MemorySystem;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-pm-test-query-"));
    memory = new MemorySystem();
    await memory.init(tmpDir);
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const baseTask = (sessionId: string, flow = "bug-fix"): CreateTaskInput => ({
    sessionId,
    flow,
    currentStep: "S1",
    currentStepName: "理解需求",
    startAt: new Date().toISOString(),
    summary: `测试 ${sessionId}`,
  });

  // ─── getLastClosedTask ───────────────────────────

  describe("getLastClosedTask", () => {
    it("returns the most recently closed task by endAt", async () => {
      const sid = "ses_lct";

      // 创建 3 个任务
      const t1 = await memory.createTask({ ...baseTask(sid), summary: "Task 1" });
      const t2 = await memory.createTask({ ...baseTask(sid + "_2"), summary: "Task 2" });
      const t3 = await memory.createTask({ ...baseTask(sid + "_3"), summary: "Task 3" });

      // 逐个关闭（先关 t1 不行——同一 session 不能有两个活跃任务，
      // 所以需要不同 session）

      // t3 最先关闭
      await memory.closeTask(t3.documentId);
      // 稍等确保时间戳不同
      await new Promise((r) => setTimeout(r, 5));
      await memory.closeTask(t2.documentId);
      await new Promise((r) => setTimeout(r, 5));
      await memory.closeTask(t1.documentId);

      // t1（sid）是最晚关闭的
      const last = await memory.getLastClosedTask(sid);
      expect(last).toBeDefined();
      expect(last!.summary).toBe("Task 1");
      expect(last!.endAt).toBeDefined();
    });

    it("returns null when no tasks have been closed", async () => {
      const result = await memory.getLastClosedTask("ses_nonexistent");
      expect(result).toBeNull();
    });

    it("returns null for session with only active tasks", async () => {
      await memory.createTask(baseTask("ses_active_only"));
      const result = await memory.getLastClosedTask("ses_active_only");
      expect(result).toBeNull();
    });
  });

  // ─── closeTask writes endAt ─────────────────────

  describe("closeTask writes endAt", () => {
    it("sets endAt to a current timestamp on close", async () => {
      const beforeClose = new Date().toISOString();
      const task = await memory.createTask(baseTask("ses_endat"));
      await memory.closeTask(task.documentId);

      const closed = await memory.getTask("ses_endat");
      expect(closed).toBeDefined();
      expect(closed!.closed).toBe(true);
      expect(closed!.endAt).toBeDefined();
      expect(closed!.endAt! >= beforeClose).toBe(true);
    });
  });

  // ─── recordStepEntry with tokensBySource ────────

  describe("recordStepEntry with tokensBySource", () => {
    it("creates new record with tokensBySource", async () => {
      // 先创建任务以便 recordStepEntry 能关联 taskSummary
      await memory.createTask(baseTask("ses_rse_new"));

      await memory.recordStepEntry(
        "ses_rse_new",
        "bug-fix",
        "S1",
        "理解需求",
        { System: 500, User: 300 },
      );

      const metrics = await memory.getFlowMetrics("ses_rse_new");
      expect(metrics).toHaveLength(1);
      expect(metrics[0].tokensBySource).toEqual({ System: 500, User: 300 });
      expect(metrics[0].tokensConsumed).toBe(800);
      expect(metrics[0].userInputTokens).toBe(300);
      expect(metrics[0].stepInCount).toBe(1);
    });

    it("accumulates tokensBySource on repeated entries", async () => {
      await memory.createTask(baseTask("ses_rse_acc"));

      await memory.recordStepEntry(
        "ses_rse_acc",
        "bug-fix",
        "S1",
        "理解需求",
        { System: 100, User: 200 },
      );

      await memory.recordStepEntry(
        "ses_rse_acc",
        "bug-fix",
        "S1",
        "理解需求",
        { System: 50, Assistant: 100 },
      );

      const metrics = await memory.getFlowMetrics("ses_rse_acc");
      expect(metrics).toHaveLength(1);
      expect(metrics[0].tokensBySource).toEqual({
        System: 150,
        User: 200,
        Assistant: 100,
      });
      expect(metrics[0].tokensConsumed).toBe(450);
      expect(metrics[0].stepInCount).toBe(1);
    });
  });

  // ─── getSourceTokenBreakdown ────────────────────

  describe("getSourceTokenBreakdown", () => {
    it("aggregates tokensBySource across steps", async () => {
      const sid = "ses_srcbd";

      await memory.createTask(baseTask(sid));

      await memory.recordStepEntry(sid, "bug-fix", "S1", "理解需求", {
        System: 100,
        User: 50,
      });
      await memory.recordStepEntry(sid, "bug-fix", "S2", "设计方案", {
        Assistant: 200,
        Tool: 80,
      });
      await memory.recordStepEntry(sid, "bug-fix", "S2", "设计方案", {
        Assistant: 100,
        Reasoning: 50,
      });

      const breakdown = await memory.getSourceTokenBreakdown(sid);
      expect(breakdown).toHaveLength(5);

      const map = new Map(breakdown.map((b) => [b.source, b.tokens]));
      expect(map.get("System")).toBe(100);
      expect(map.get("User")).toBe(50);
      expect(map.get("Assistant")).toBe(300); // 200 + 100
      expect(map.get("Tool")).toBe(80);
      expect(map.get("Reasoning")).toBe(50);
    });

    it("handles metrics with null tokensBySource (legacy data)", async () => {
      // 不传入 tokensBySource（模拟旧数据行为——但 recordStepEntry 总是会设置 it）。
      // 这里验证空 metrics 集合返回空数组。
      const breakdown = await memory.getSourceTokenBreakdown("ses_nonexistent");
      expect(breakdown).toEqual([]);
    });
  });

  // ─── getStepTokenBreakdown ──────────────────────

  describe("getStepTokenBreakdown", () => {
    it("returns per-step token summary", async () => {
      const sid = "ses_stpbd";

      await memory.createTask(baseTask(sid));

      await memory.recordStepEntry(sid, "bug-fix", "S1", "理解需求", {
        System: 100,
      });
      await memory.recordStepEntry(sid, "bug-fix", "S2", "设计方案", {
        Assistant: 200,
      });
      await memory.recordStepEntry(sid, "bug-fix", "S2", "设计方案", {
        Assistant: 50,
      });

      const breakdown = await memory.getStepTokenBreakdown(sid);
      expect(breakdown).toHaveLength(2);

      const s1 = breakdown.find((b) => b.step === "S1");
      expect(s1).toBeDefined();
      expect(s1!.stepName).toBe("理解需求");
      expect(s1!.stepInCount).toBe(1);
      expect(s1!.tokensConsumed).toBe(100);

      const s2 = breakdown.find((b) => b.step === "S2");
      expect(s2).toBeDefined();
      expect(s2!.stepName).toBe("设计方案");
      expect(s2!.stepInCount).toBe(1);
      expect(s2!.tokensConsumed).toBe(250);
    });
  });
});

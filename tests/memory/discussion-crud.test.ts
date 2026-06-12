/**
 * Discussion CRUD 测试 — AxioDB 单实例，整个文件共享 MemorySystem
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { MemorySystem } from "../../src/memory/memory-system.js";
import type {
  CreateDiscussionInput,
  CreateTaskInput,
} from "../../src/memory/types.js";

describe("Discussion CRUD", () => {
  let tmpDir: string;
  let memory: MemorySystem;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-pm-test-disc-"));
    memory = new MemorySystem();
    await memory.init(tmpDir);
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const baseInput = (sid: string): CreateDiscussionInput => ({
    fromSessionId: sid,
    priority: "high",
    importance: 3,
    severity: 4,
    issue: "步骤 S3 耗时过长",
    reason: "用户需要大量输入",
    solution: "拆分 S3 为多个子步骤",
  });

  it("create_discussion_auto_fills_taskSummary", async () => {
    const task: CreateTaskInput = {
      sessionId: "ses_d1",
      flow: "project-build",
      currentStep: "S3",
      currentStepName: "需求澄清",
      startAt: new Date().toISOString(),
      summary: "构建用户认证模块",
    };
    await memory.createTask(task);

    const d = await memory.createDiscussion(baseInput("ses_d1"));
    expect(d.taskSummary).toBe("构建用户认证模块");
    expect(d.id).toBeDefined();
    expect(d.createdAt).toBeDefined();
  });

  it("get_unresolved_only: 只返回未决议的讨论项", async () => {
    const d1 = await memory.createDiscussion(baseInput("ses_u1"));
    const d2 = await memory.createDiscussion(baseInput("ses_u2"));
    await memory.resolveDiscussion(d1.id, "采纳");
    const unresolved = await memory.getUnresolvedDiscussions();
    expect(unresolved.find((d) => d.id === d2.id)).toBeDefined();
  });

  it("resolve_discussion: 决议后设置 decision 和 resolvedAt", async () => {
    const d = await memory.createDiscussion(baseInput("ses_r1"));
    await memory.resolveDiscussion(d.id, "部分采纳");
    const discussions = await memory.getDiscussions("ses_r1");
    const resolved = discussions.find((x) => x.id === d.id)!;
    expect(resolved.decision).toBe("部分采纳");
    expect(resolved.resolvedAt).toBeDefined();
  });

  it("listDiscussions_with_filter: 按优先级和未决议过滤", async () => {
    await memory.createDiscussion({ ...baseInput("ses_fh"), priority: "high" });
    await memory.createDiscussion({
      ...baseInput("ses_fm"),
      priority: "medium",
    });
    const high = await memory.listDiscussions({ priority: "high" });
    expect(high.length).toBeGreaterThanOrEqual(1);
    const unresolved = await memory.listDiscussions({ unresolved: true });
    expect(unresolved.length).toBeGreaterThanOrEqual(2);
  });
});

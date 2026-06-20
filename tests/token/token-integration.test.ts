/**
 * Token 计数集成测试
 *
 * 验证 messages.transform 和 chat.message hook 与 TokenCounter 的集成正确性。
 * 使用 mock tiktoken + 真实 MemorySystem + 真实 TokenCounter。
 */

import { describe, it, expect, mock, beforeAll, afterAll } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { MemorySystem } from "../../src/memory/memory-system.js";
import { TokenCounter } from "../../src/token/token-counter.js";
import type { PartInfo } from "../../src/token/types.js";
import type { CreateTaskInput } from "../../src/memory/types.js";

// Mock tiktoken
mock.module("tiktoken", () => ({
  get_encoding: mock((_encoding: string) => ({
    encode: mock((text: string) => {
      const len = Math.max(1, Math.ceil(text.length / 4));
      return new Uint32Array(len);
    }),
    free: mock(() => {}),
  })),
  TiktokenEncoding: mock(() => {}),
}));

describe("Token Integration", () => {
  let tmpDir: string;
  let memory: MemorySystem;
  let tokenCounter: TokenCounter;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-pm-test-integ-"));
    memory = new MemorySystem();
    await memory.init(tmpDir);
    tokenCounter = new TokenCounter("cl100k_base");
  });

  afterAll(() => {
    tokenCounter.dispose();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makePart(overrides: Partial<PartInfo> = {}): PartInfo {
    return { type: "text", text: "hello", ...overrides };
  }

  async function setupActiveTask(sessionId: string, flow = "bug-fix") {
    const input: CreateTaskInput = {
      sessionId,
      flow,
      currentStep: "S1",
      currentStepName: "理解需求",
      startAt: new Date().toISOString(),
      summary: "集成测试",
    };
    return memory.createTask(input);
  }

  // ─── messages.transform 集成 ────────────────────

  describe("messages.transform integration", () => {
    it("records prompt tokens with correct bySource for active task", async () => {
      const sessionId = "ses_transform_active";
      await setupActiveTask(sessionId);

      // 模拟注入 FlowControl 的场景
      const originalParts: PartInfo[] = [
        makePart({ role: "user", text: "Write a function to add two numbers" }),
      ];

      const injectedParts: PartInfo[] = [
        ...originalParts,
        makePart({
          type: "text",
          text: "<protect># Flow Rules\n\nExecute step S1 first.</protect>",
        }),
      ];

      const result = tokenCounter.countPromptTokens(injectedParts, originalParts);

      // 记录到 memory
      await memory.recordStepEntry(
        sessionId,
        "bug-fix",
        "S1",
        "理解需求",
        result.bySource,
      );

      const metrics = await memory.getFlowMetrics(sessionId);
      expect(metrics).toHaveLength(1);
      expect(metrics[0].tokensBySource["User"]).toBeGreaterThan(0);
      expect(metrics[0].tokensBySource["FlowControl"]).toBeGreaterThan(0);
      expect(metrics[0].stepInCount).toBe(1);
    });

    it("correctly isolates FlowControl tokens from User tokens", async () => {
      const sessionId = "ses_transform_fc";
      await setupActiveTask(sessionId);

      const originalParts: PartInfo[] = [
        makePart({ role: "user", text: "Fix the login bug" }),
      ];

      const fcText = "<protect># Rules\n\nDon't skip S1.</protect>";
      const injectedParts: PartInfo[] = [
        ...originalParts,
        makePart({ type: "text", text: fcText }),
      ];

      const result = tokenCounter.countPromptTokens(injectedParts, originalParts);

      // User token 应等于原始 User text 的 token
      const expectedUserTokens = Math.ceil("Fix the login bug".length / 4);
      expect(result.bySource["User"]).toBe(expectedUserTokens);

      // FlowControl token 应等于 FC text 的 token
      const expectedFCTokens = Math.ceil(fcText.length / 4);
      expect(result.bySource["FlowControl"]).toBe(expectedFCTokens);

      // 验证总和
      expect(result.total).toBe(expectedUserTokens + expectedFCTokens);
    });
  });

  // ─── chat.message 集成 ──────────────────────────

  describe("chat.message integration", () => {
    it("records completion tokens for assistant + tool parts", async () => {
      const sessionId = "ses_chat_active";
      await setupActiveTask(sessionId);

      const completionParts: PartInfo[] = [
        makePart({
          role: "assistant",
          text: "Here is the fix:\n\n```ts\nconst x = 1;\n```\n\nThis should work.",
        }),
        makePart({ type: "tool", text: "Execution result: test passed" }),
      ];

      const result = tokenCounter.countCompletionTokens(completionParts);

      await memory.recordStepEntry(
        sessionId,
        "bug-fix",
        "S1",
        "理解需求",
        result.bySource,
      );

      const metrics = await memory.getFlowMetrics(sessionId);
      expect(metrics).toHaveLength(1);
      expect(metrics[0].tokensBySource["Assistant"]).toBeGreaterThan(0);
      expect(metrics[0].tokensBySource["Tool"]).toBeGreaterThan(0);
    });
  });

  // ─── 无活跃任务时跳过 ───────────────────────────

  describe("no active task skip", () => {
    it("does not record tokens when no active task exists", async () => {
      const sessionId = "ses_no_task";

      // 无任务创建 → getActiveTask 返回 null
      const task = await memory.getActiveTask(sessionId);
      expect(task).toBeNull();

      // 验证没有 metrics 被意外写入
      const metrics = await memory.getFlowMetrics(sessionId);
      expect(metrics).toHaveLength(0);
    });
  });
});

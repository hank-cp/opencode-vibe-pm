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
import type { Part, Message } from "@opencode-ai/sdk";
import type { MessagePack } from "../../src/token/types.js";
import type { CreateTaskInput } from "../../src/memory/types.js";

// Mock tiktoken
mock.module("tiktoken", () => {
  const makeEncoder = () => ({
    encode: mock((text: string) => {
      const len = Math.max(1, Math.ceil(text.length / 4));
      return new Uint32Array(len);
    }),
    free: mock(() => {}),
  });
  return {
    get_encoding: mock((_encoding: string) => makeEncoder()),
    encoding_for_model: mock((_model: string) => makeEncoder()),
  };
});


// ─── Helpers ───

interface TextPartStub { type: "text"; text: string }
interface ToolPartStub { type: "tool"; text?: string; args?: unknown; state?: { input?: unknown; output?: string; error?: string } }
interface ReasoningPartStub { type: "reasoning"; text: string }

type PartStub = TextPartStub | ToolPartStub | ReasoningPartStub;

function makeTextPart(text: string): TextPartStub {
  return { type: "text", text };
}

function makeToolPart(overrides: Partial<ToolPartStub> = {}): ToolPartStub {
  return { type: "tool", ...overrides };
}

function makeUserMessage(parts: PartStub[]): MessagePack {
  return {
    info: { role: "user" } as Message,
    parts: parts as Part[],
  };
}

function makeAssistantMessage(parts: PartStub[]): MessagePack {
  return {
    info: { role: "assistant" } as Message,
    parts: parts as Part[],
  };
}

describe("Token Integration", () => {
  let tmpDir: string;
  let memory: MemorySystem;
  let tokenCounter: TokenCounter;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-pm-test-integ-"));
    memory = new MemorySystem();
    await memory.init(tmpDir);
    tokenCounter = new TokenCounter({ providerID: "openai", modelID: "gpt-4" });
  });

  afterAll(() => {
    tokenCounter.dispose();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

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

      // 模拟注入 FlowControl 的场景：user message 包含文本 + FlowControl
      const msg = makeUserMessage([
        makeTextPart("Write a function to add two numbers"),
        makeTextPart("<protect># Flow Rules\n\nExecute step S1 first.</protect>"),
      ]);

      const result = tokenCounter.countContextTokens(msg);

      // 记录到 memory — recordStepEntry 现在接受 TokenCount
      await memory.recordStepTokens(
        sessionId,
        "bug-fix",
        "S1",
        "理解需求",
        result,
      );

      const metrics = await memory.getStepTokenMetrics(sessionId);
      expect(metrics).toHaveLength(1);
      // tokensBySource uses old-style keys: User, FlowControl (mapped from TokenCount in recordStepEntry)
      expect(metrics[0].tokensBySource["User"]).toBeGreaterThan(0);
      expect(metrics[0].tokensBySource["FlowControl"]).toBeGreaterThan(0);
      expect(metrics[0].stepInCount).toBe(1);
    });

    it("correctly isolates FlowControl tokens from User text tokens", async () => {
      const sessionId = "ses_transform_fc";
      await setupActiveTask(sessionId);

      const msg = makeUserMessage([
        makeTextPart("Fix the login bug"),
        makeTextPart("<protect># Rules\n\nDon't skip S1.</protect>"),
      ]);

      const result = tokenCounter.countContextTokens(msg);

      // FlowControl token = FC text 的 token
      const fcText = "<protect># Rules\n\nDon't skip S1.</protect>";
      const expectedFCTokens = Math.ceil(fcText.length / 4);
      expect(result.flowControl).toBe(expectedFCTokens);

      // user total = text + flowControl
      const expectedUserTokens =
        Math.ceil("Fix the login bug".length / 4) + expectedFCTokens;
      expect(result.user).toBe(expectedUserTokens);
      expect(result.assistant).toBe(0);
    });
  });

  // ─── chat.message 集成 ──────────────────────────

  describe("chat.message integration", () => {
    it("records completion tokens for assistant + tool parts", async () => {
      const sessionId = "ses_chat_active";
      await setupActiveTask(sessionId);

      const msg = makeAssistantMessage([
        makeTextPart("Here is the fix:\n\n```ts\nconst x = 1;\n```\n\nThis should work."),
        makeToolPart({ text: "Execution result: test passed" }),
      ]);

      const result = tokenCounter.countContextTokens(msg);

      await memory.recordStepTokens(
        sessionId,
        "bug-fix",
        "S1",
        "理解需求",
        result,
      );

      const metrics = await memory.getStepTokenMetrics(sessionId);
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
      const metrics = await memory.getStepTokenMetrics(sessionId);
      expect(metrics).toHaveLength(0);
    });
  });
});

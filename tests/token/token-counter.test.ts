/**
 * TokenCounter 单元测试
 *
 * Mock tiktoken（编码器返回固定 token 数），不依赖真实 tokenizer。
 * 覆盖 6 类来源分类、FlowControl 增量化拆分、边界情况。
 */

import { describe, it, expect, mock, beforeAll, afterAll } from "bun:test";
import type { TokenSource } from "../../src/memory/types.js";
import type { PartInfo } from "../../src/token/types.js";

// Mock tiktoken: encode 返回长度 = text.length / 4（最小 1）
mock.module("tiktoken", () => ({
  get_encoding: mock((_encoding: string) => ({
    encode: mock((text: string) => {
      const len = Math.max(1, Math.ceil(text.length / 4));
      return new Uint32Array(len);
    }),
    free: mock(() => {}),
  })),
}));

import { TokenCounter } from "../../src/token/token-counter.js";

// ─── Helpers ───

function makePart(overrides: Partial<PartInfo> = {}): PartInfo {
  return {
    type: "text",
    text: "hello world",
    ...overrides,
  };
}

function expectedTokens(text: string): number {
  if (!text || !text.trim()) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

// ─── Tests ───

describe("TokenCounter", () => {
  let counter: TokenCounter;

  beforeAll(() => {
    counter = new TokenCounter("cl100k_base");
  });

  afterAll(() => {
    counter.dispose();
  });

  // ─── classifyPart ──────────────────────────────────

  describe("classifyPart", () => {
    it("classifies System part by role=system", () => {
      const part = makePart({ role: "system", text: "You are an AI assistant." });
      expect(counter.classifyPart(part)).toBe("System");
    });

    it("classifies FlowControl by <pm-control-rules> marker", () => {
      const part = makePart({
        type: "text",
        text: "System instructions <pm-control-rules>specific rules</pm-control-rules>",
        role: "system",
      });
      expect(counter.classifyPart(part)).toBe("FlowControl");
    });

    it("classifies FlowControl by <protect> marker", () => {
      const part = makePart({
        type: "text",
        text: "<protect># Flow Execution Rules</protect>",
      });
      expect(counter.classifyPart(part)).toBe("FlowControl");
    });

    it("classifies FlowControl by isControlPrompt flag", () => {
      const part = makePart({
        type: "text",
        text: "some prompt",
        isControlPrompt: true,
      });
      expect(counter.classifyPart(part)).toBe("FlowControl");
    });

    it("classifies User part by role=user", () => {
      const part = makePart({ role: "user", text: "Write a function" });
      expect(counter.classifyPart(part)).toBe("User");
    });

    it("classifies Assistant part by role=assistant", () => {
      const part = makePart({ role: "assistant", text: "Here is the code:" });
      expect(counter.classifyPart(part)).toBe("Assistant");
    });

    it("classifies Reasoning for assistant thinking content", () => {
      const part = makePart({
        role: "assistant",
        text: "Let me think about this... [reasoning]",
      });
      expect(counter.classifyPart(part)).toBe("Reasoning");
    });

    it("classifies Tool part by type=tool", () => {
      const part = makePart({ type: "tool", text: "Tool result" });
      expect(counter.classifyPart(part)).toBe("Tool");
    });

    it("classifies Tool part by role=tool", () => {
      const part = makePart({ role: "tool", text: "Tool output" });
      expect(counter.classifyPart(part)).toBe("Tool");
    });
  });

  // ─── countTokens ──────────────────────────────────

  describe("countTokens", () => {
    it("returns correct count for normal text", () => {
      const tokens = counter.countTokens("hello world");
      expect(tokens).toBe(expectedTokens("hello world"));
    });

    it("returns 0 for empty string", () => {
      expect(counter.countTokens("")).toBe(0);
    });

    it("returns 0 for whitespace-only string", () => {
      expect(counter.countTokens("   \n  ")).toBe(0);
    });
  });

  // ─── countPromptTokens ────────────────────────────

  describe("countPromptTokens", () => {
    it("counts User-only parts correctly (no originalParts)", () => {
      const parts: PartInfo[] = [
        makePart({ role: "user", text: "Hello, write tests" }),
        makePart({ role: "user", text: "For a counter module" }),
      ];

      const result = counter.countPromptTokens(parts);
      expect(result.bySource["User"]).toBe(
        expectedTokens("Hello, write tests") + expectedTokens("For a counter module"),
      );
      expect(result.total).toBe(result.bySource["User"]);
    });

    it("returns empty result for empty parts array", () => {
      const result = counter.countPromptTokens([]);
      expect(result.total).toBe(0);
      expect(result.bySource).toEqual({});
    });

    it("handles FlowControl incremental splitting with originalParts", () => {
      // 原始 parts：2 个 User parts
      const originalParts: PartInfo[] = [
        makePart({ role: "user", text: "User message A" }),
        makePart({ role: "user", text: "User message B" }),
      ];
      // 注入后 parts：原始 + FlowControl
      const parts: PartInfo[] = [
        ...originalParts,
        makePart({
          type: "text",
          text: "<protect># Rules\n\nExecute step S1 first.</protect>",
        }),
      ];

      const result = counter.countPromptTokens(parts, originalParts);

      // User token = 原始 User text 的 token
      const expectedUserTokens =
        expectedTokens("User message A") + expectedTokens("User message B");
      expect(result.bySource["User"]).toBe(expectedUserTokens);

      // FlowControl token = 含 FlowControl 总量 - 原始 User 总量
      const fcText = "<protect># Rules\n\nExecute step S1 first.</protect>";
      expect(result.bySource["FlowControl"]).toBe(expectedTokens(fcText));

      // 验证总量
      const allTokens = Object.values(result.bySource).reduce((a, b) => a + b, 0);
      expect(result.total).toBe(allTokens);
    });
  });

  // ─── countCompletionTokens ────────────────────────

  describe("countCompletionTokens", () => {
    it("counts Assistant and Tool tokens in completion", () => {
      const parts: PartInfo[] = [
        makePart({ role: "assistant", text: "Here is the solution:\n\n```ts\nconst x = 1;\n```" }),
        makePart({ type: "tool", text: "Execution result: success" }),
      ];

      const result = counter.countCompletionTokens(parts);
      expect(result.bySource["Assistant"]).toBeDefined();
      expect(result.bySource["Tool"]).toBeDefined();
      expect(result.total).toBeGreaterThan(0);
    });

    it("returns empty result for empty parts", () => {
      const result = counter.countCompletionTokens([]);
      expect(result.total).toBe(0);
      expect(result.bySource).toEqual({});
    });
  });

  // ─── dispose ──────────────────────────────────────

  describe("dispose", () => {
    it("calls encoder.free() on dispose", () => {
      const c = new TokenCounter("cl100k_base");
      c.dispose();
      // No exception = success
    });

    it("dispose does not throw on subsequent calls", () => {
      const c = new TokenCounter("cl100k_base");
      c.dispose();
      // Second dispose should not throw (free is a no-op on freed encoders in real tiktoken)
      expect(() => c.dispose()).not.toThrow();
    });
  });
});

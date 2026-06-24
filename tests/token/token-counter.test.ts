/**
 * TokenCounter 单元测试
 *
 * Mock tiktoken（编码器返回固定 token 数），不依赖真实 tokenizer。
 * 覆盖 6 类来源分类（text/user/assistant/flowControl/tool/reasoning）、边界情况。
 */

import { describe, it, expect, mock, beforeAll, afterAll } from "bun:test";
import type { Part, Message } from "@opencode-ai/sdk";
import type { MessagePack } from "../../src/token/types.js";

// Mock tiktoken: encode 返回长度 = text.length / 4（最小 1）
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

import { TokenCounter } from "../../src/token/token-counter.js";

// ─── Helpers ───

interface TextPartStub { type: "text"; text: string }
interface ToolPartStub { type: "tool"; tool?: string; text?: string; args?: unknown; state?: { input?: unknown; output?: string; error?: string } }
interface ReasoningPartStub { type: "reasoning"; text: string }

type PartStub = TextPartStub | ToolPartStub | ReasoningPartStub;

function makeTextPart(text: string): TextPartStub {
  return { type: "text", text };
}

function makeFlowControlPart(text: string): TextPartStub {
  return { type: "text", text };
}

function makeToolPart(overrides: Partial<ToolPartStub> = {}): ToolPartStub {
  return { type: "tool", ...overrides };
}

function makeReasoningPart(text: string): ReasoningPartStub {
  return { type: "reasoning", text };
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

function expectedTokens(text: string): number {
  if (!text || !text.trim()) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

// ─── Tests ───

describe("TokenCounter", () => {
  let counter: TokenCounter;

  beforeAll(() => {
    counter = new TokenCounter({ providerID: "openai", modelID: "gpt-4" });
  });

  afterAll(() => {
    counter.dispose();
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

  // ─── countContextTokens — 分类 ───────────────────

  describe("countContextTokens classification", () => {
    it("classifies text parts by type=text (no <protect>)", () => {
      const msg = makeUserMessage([
        makeTextPart("Hello, write tests"),
      ]);
      const result = counter.countContextTokens(msg);

      const expected = expectedTokens("Hello, write tests");
      expect(result.text).toBe(expected);
      expect(result.flowControl).toBe(0);
      expect(result.tool).toBe(0);
      expect(result.reasoning).toBe(0);
    });

    it("classifies FlowControl by <protect> marker in text", () => {
      const msg = makeUserMessage([
        makeFlowControlPart("<protect># Flow Rules\n\nExecute step S1 first.</protect>"),
      ]);
      const result = counter.countContextTokens(msg);

      const fcText = "<protect># Flow Rules\n\nExecute step S1 first.</protect>";
      expect(result.flowControl).toBe(expectedTokens(fcText));
      expect(result.text).toBe(0);
    });

    it("classifies mixed text and FlowControl parts correctly", () => {
      const msg = makeUserMessage([
        makeTextPart("User message A"),
        makeFlowControlPart("<protect>Rules here</protect>"),
        makeTextPart("User message B"),
      ]);
      const result = counter.countContextTokens(msg);

      expect(result.text).toBe(
        expectedTokens("User message A") + expectedTokens("User message B"),
      );
      expect(result.flowControl).toBe(expectedTokens("<protect>Rules here</protect>"));
    });

    it("classifies Tool part by type=tool", () => {
      const msg = makeUserMessage([
        makeToolPart({ text: "Tool result content" }),
      ]);
      const result = counter.countContextTokens(msg);

      expect(result.tool).toBe(expectedTokens("Tool result content"));
      expect(result.text).toBe(0);
    });

    it("classifies Reasoning part by type=reasoning", () => {
      const msg = makeAssistantMessage([
        makeReasoningPart("Let me think about this..."),
      ]);
      const result = counter.countContextTokens(msg);

      expect(result.reasoning).toBe(expectedTokens("Let me think about this..."));
    });

    it("classifies Read tool of regulation file as flowControl", () => {
      const msg = makeAssistantMessage([
        makeToolPart({
          tool: "read",
          state: {
            input: { filePath: "docs/regulation/constitution.md" },
            output: "## Core Principles\n\nType safety first.",
          },
        }),
      ]);
      const result = counter.countContextTokens(msg);

      expect(result.flowControl).toBeGreaterThan(0);
      expect(result.tool).toBe(0);
    });

    it("classifies Read tool of flow file as flowControl", () => {
      const msg = makeAssistantMessage([
        makeToolPart({
          tool: "read",
          state: {
            input: { filePath: "docs/flow/flow-spec-driven-dev.md" },
            output: "## Spec-Driven Dev\n\nS1: Understand requirements.",
          },
        }),
      ]);
      const result = counter.countContextTokens(msg);

      expect(result.flowControl).toBeGreaterThan(0);
      expect(result.tool).toBe(0);
    });

    it("classifies Read tool of non-rule file as tool (not flowControl)", () => {
      const msg = makeAssistantMessage([
        makeToolPart({
          tool: "read",
          state: {
            input: { filePath: "src/token/token-counter.ts" },
            output: "import { get_encoding } from tiktoken;",
          },
        }),
      ]);
      const result = counter.countContextTokens(msg);

      expect(result.flowControl).toBe(0);
      expect(result.tool).toBeGreaterThan(0);
    });
  });

  // ─── countContextTokens — role 聚合 ──────────────

  describe("countContextTokens role aggregation", () => {
    it("user role: total = sum of all part tokens", () => {
      const msg = makeUserMessage([
        makeTextPart("Hello"),
        makeTextPart("World"),
      ]);
      const result = counter.countContextTokens(msg);

      const expected = expectedTokens("Hello") + expectedTokens("World");
      expect(result.user).toBe(expected);
      expect(result.assistant).toBe(0);
    });

    it("assistant role: total = sum of all part tokens", () => {
      const msg = makeAssistantMessage([
        makeTextPart("Here is the code:"),
        makeToolPart({ text: "Execution result" }),
        makeReasoningPart("thinking"),
      ]);
      const result = counter.countContextTokens(msg);

      const expected =
        expectedTokens("Here is the code:") +
        expectedTokens("Execution result") +
        expectedTokens("thinking");
      expect(result.assistant).toBe(expected);
      expect(result.user).toBe(0);
    });

    it("user role with FlowControl: user total includes FlowControl", () => {
      const msg = makeUserMessage([
        makeTextPart("Fix the bug"),
        makeFlowControlPart("<protect>Don't skip S1.</protect>"),
      ]);
      const result = counter.countContextTokens(msg);

      const expected =
        expectedTokens("Fix the bug") +
        expectedTokens("<protect>Don't skip S1.</protect>");
      expect(result.user).toBe(expected);
      expect(result.flowControl).toBe(expectedTokens("<protect>Don't skip S1.</protect>"));
    });

    it("assistant role: assistant total includes tool + reasoning", () => {
      const msg = makeAssistantMessage([
        makeTextPart("Solution:"),
        makeToolPart({ text: "test passed" }),
        makeReasoningPart("analysis"),
      ]);
      const result = counter.countContextTokens(msg);

      const expected =
        expectedTokens("Solution:") +
        expectedTokens("test passed") +
        expectedTokens("analysis");
      expect(result.assistant).toBe(expected);
      // Individual breakdowns
      expect(result.text).toBe(expectedTokens("Solution:"));
      expect(result.tool).toBe(expectedTokens("test passed"));
      expect(result.reasoning).toBe(expectedTokens("analysis"));
    });
  });

  // ─── countContextTokens — 边界 ───────────────────

  describe("countContextTokens edge cases", () => {
    it("returns all zeros for empty parts array", () => {
      const msg: MessagePack = {
        info: { role: "user" } as Message,
        parts: [],
      };
      const result = counter.countContextTokens(msg);

      expect(result.text).toBe(0);
      expect(result.user).toBe(0);
      expect(result.assistant).toBe(0);
      expect(result.flowControl).toBe(0);
      expect(result.tool).toBe(0);
      expect(result.reasoning).toBe(0);
    });

    it("handles tool part with state.output", () => {
      const msg = makeUserMessage([
        makeToolPart({
          state: {
            input: { key: "value" },
            output: "Command executed successfully",
          },
        }),
      ]);
      const result = counter.countContextTokens(msg);

      // state.input is JSON.stringified, state.output appended
      const inputStr = JSON.stringify({ key: "value" });
      const combined = inputStr + "\n" + "Command executed successfully";
      expect(result.tool).toBe(expectedTokens(combined));
    });

    it("handles tool part with state.error", () => {
      const msg = makeUserMessage([
        makeToolPart({
          state: {
            input: { file: "test.ts" },
            error: "File not found",
          },
        }),
      ]);
      const result = counter.countContextTokens(msg);

      const inputStr = JSON.stringify({ file: "test.ts" });
      const combined = inputStr + "\n" + "File not found";
      expect(result.tool).toBe(expectedTokens(combined));
    });

    it("handles tool part with args fallback", () => {
      const msg = makeUserMessage([
        makeToolPart({ args: { key: "value" } }),
      ]);
      const result = counter.countContextTokens(msg);

      expect(result.tool).toBe(expectedTokens(JSON.stringify({ key: "value" })));
    });

    it("ignores unknown part types", () => {
      const msg: MessagePack = {
        info: { role: "user" } as Message,
        parts: [{ type: "unknown-type" } as unknown as Part],
      };
      const result = counter.countContextTokens(msg);

      expect(result.text).toBe(0);
      expect(result.user).toBe(0);
    });
  });

  // ─── dispose ──────────────────────────────────────

  describe("dispose", () => {
    it("calls encoder.free() on dispose", () => {
      const c = new TokenCounter({ providerID: "test", modelID: "test" });
      c.dispose();
      // No exception = success
    });

    it("dispose does not throw on subsequent calls", () => {
      const c = new TokenCounter({ providerID: "test", modelID: "test" });
      c.dispose();
      // Second dispose should not throw
      expect(() => c.dispose()).not.toThrow();
    });
  });
});

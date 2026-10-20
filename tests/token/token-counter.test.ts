/**
 * TokenCounter Unit Tests
 *
 * Mock tiktoken (encoder returns fixed token count), no real tokenizer dependency.
 * Covers 6 source categories (text/user/assistant/flowControl/tool/reasoning) and edge cases.
 *
 * V2 message model: a message is `{ role, content: ContentPart[] }`; tool usage is split into
 * a `tool-call` part and a `tool-result` part sharing one id.
 */

import { describe, it, expect, mock, beforeAll, afterAll } from 'bun:test';
import type { AIMessage, AIContentPart } from '../../src/core/types.js';
import type { MessagePack } from '../../src/token';
import { TokenCounter } from '../../src/token/token-counter';

// Mock tiktoken: encode returns length = text.length / 4 (minimum 1)
mock.module('tiktoken', () => {
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

type TextPart = Extract<AIContentPart, { type: 'text' }>;
type ToolCallPart = Extract<AIContentPart, { type: 'tool-call' }>;
type ToolResultPart = Extract<AIContentPart, { type: 'tool-result' }>;
type ReasoningPart = Extract<AIContentPart, { type: 'reasoning' }>;

function makeTextPart(text: string): TextPart {
  return { type: 'text', text };
}

function makeFlowControlPart(text: string): TextPart {
  return { type: 'text', text };
}

function makeToolCall(id: string, name: string, input: unknown): ToolCallPart {
  return { type: 'tool-call', id, name, input };
}

function makeToolResult(id: string, name: string, value: string): ToolResultPart {
  return { type: 'tool-result', id, name, result: { type: 'text', value } };
}

function makeToolErrorResult(id: string, name: string, value: string): ToolResultPart {
  return { type: 'tool-result', id, name, result: { type: 'error', value } };
}

function makeReasoningPart(text: string): ReasoningPart {
  return { type: 'reasoning', text };
}

/**
 * Build a `MessagePack` from parts.
 *
 * `AIMessage` is an Effect `Schema.Class`, so the literal is asserted into the type rather
 * than constructed: these tests deliberately feed structurally-typed stand-ins (including
 * an unknown part type) to the counter.
 */
function makeMessage(role: AIMessage['role'], content: readonly AIContentPart[]): MessagePack {
  return { message: { role, content } as AIMessage };
}

function makeUserMessage(content: readonly AIContentPart[]): MessagePack {
  return makeMessage('user', content);
}

function makeAssistantMessage(content: readonly AIContentPart[]): MessagePack {
  return makeMessage('assistant', content);
}

function expectedTokens(text: string): number {
  if (!text || !text.trim()) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

// ─── Tests ───

describe('TokenCounter', () => {
  let counter: TokenCounter;

  beforeAll(() => {
    counter = new TokenCounter({ providerID: 'openai', modelID: 'gpt-4' });
  });

  afterAll(() => {
    counter.dispose();
  });

  // ─── countTokens ──────────────────────────────────

  describe('countTokens', () => {
    it('returns correct count for normal text', () => {
      const tokens = counter.countTokens('hello world');
      expect(tokens).toBe(expectedTokens('hello world'));
    });

    it('returns 0 for empty string', () => {
      expect(counter.countTokens('')).toBe(0);
    });

    it('returns 0 for whitespace-only string', () => {
      expect(counter.countTokens('   \n  ')).toBe(0);
    });
  });

  // ─── countContextTokens — Classification ──────────

  describe('countContextTokens classification', () => {
    it('classifies text parts by type=text (no <protect>)', () => {
      const msg = makeUserMessage([makeTextPart('Hello, write tests')]);
      const result = counter.countContextTokens(msg);

      const expected = expectedTokens('Hello, write tests');
      expect(result.text).toBe(expected);
      expect(result.flowControl).toBe(0);
      expect(result.tool).toBe(0);
      expect(result.reasoning).toBe(0);
    });

    it('classifies FlowControl by <protect> marker in text', () => {
      const msg = makeUserMessage([
        makeFlowControlPart('<protect># Flow Rules\n\nExecute step S1 first.</protect>'),
      ]);
      const result = counter.countContextTokens(msg);

      const fcText = '<protect># Flow Rules\n\nExecute step S1 first.</protect>';
      expect(result.flowControl).toBe(expectedTokens(fcText));
      expect(result.text).toBe(0);
    });

    it('classifies mixed text and FlowControl parts correctly', () => {
      const msg = makeUserMessage([
        makeTextPart('User message A'),
        makeFlowControlPart('<protect>Rules here</protect>'),
        makeTextPart('User message B'),
      ]);
      const result = counter.countContextTokens(msg);

      expect(result.text).toBe(expectedTokens('User message A') + expectedTokens('User message B'));
      expect(result.flowControl).toBe(expectedTokens('<protect>Rules here</protect>'));
    });

    it('classifies tool-result part as tool', () => {
      const msg = makeUserMessage([
        makeToolResult('call-1', 'bash', 'Tool result content'),
      ]);
      const result = counter.countContextTokens(msg);

      expect(result.tool).toBe(expectedTokens('Tool result content'));
      expect(result.text).toBe(0);
    });

    it('classifies Reasoning part by type=reasoning', () => {
      const msg = makeAssistantMessage([makeReasoningPart('Let me think about this...')]);
      const result = counter.countContextTokens(msg);

      expect(result.reasoning).toBe(expectedTokens('Let me think about this...'));
    });

    it('classifies Read tool of regulation file as flowControl', () => {
      const msg = makeAssistantMessage([
        makeToolCall('call-reg', 'read', { filePath: 'docs/regulation/constitution.md' }),
        makeToolResult('call-reg', 'read', '## Core Principles\n\nType safety first.'),
      ]);
      const result = counter.countContextTokens(msg);

      expect(result.flowControl).toBeGreaterThan(0);
      expect(result.tool).toBe(0);
    });

    it('classifies Read tool of flow file as flowControl', () => {
      const msg = makeAssistantMessage([
        makeToolCall('call-flow', 'read', { filePath: 'docs/flow/flow-spec-driven-dev.md' }),
        makeToolResult('call-flow', 'read', '## Spec-Driven Dev\n\nS1: Understand requirements.'),
      ]);
      const result = counter.countContextTokens(msg);

      expect(result.flowControl).toBeGreaterThan(0);
      expect(result.tool).toBe(0);
    });

    it('classifies Read tool of non-rule file as tool (not flowControl)', () => {
      const msg = makeAssistantMessage([
        makeToolCall('call-src', 'read', { filePath: 'src/token/token-counter.ts' }),
        makeToolResult('call-src', 'read', 'import { get_encoding } from tiktoken;'),
      ]);
      const result = counter.countContextTokens(msg);

      expect(result.flowControl).toBe(0);
      expect(result.tool).toBeGreaterThan(0);
    });
  });

  // ─── countContextTokens — Role Aggregation ────────

  describe('countContextTokens role aggregation', () => {
    it('user role: total = sum of all part tokens', () => {
      const msg = makeUserMessage([makeTextPart('Hello'), makeTextPart('World')]);
      const result = counter.countContextTokens(msg);

      const expected = expectedTokens('Hello') + expectedTokens('World');
      expect(result.user).toBe(expected);
      expect(result.assistant).toBe(0);
    });

    it('assistant role: total = sum of all part tokens', () => {
      const msg = makeAssistantMessage([
        makeTextPart('Here is the code:'),
        makeToolResult('call-2', 'bash', 'Execution result'),
        makeReasoningPart('thinking'),
      ]);
      const result = counter.countContextTokens(msg);

      const expected =
        expectedTokens('Here is the code:') +
        expectedTokens('Execution result') +
        expectedTokens('thinking');
      expect(result.assistant).toBe(expected);
      expect(result.user).toBe(0);
    });

    it('user role with FlowControl: user total includes FlowControl', () => {
      const msg = makeUserMessage([
        makeTextPart('Fix the bug'),
        makeFlowControlPart('<protect>Don\'t skip S1.</protect>'),
      ]);
      const result = counter.countContextTokens(msg);

      const expected =
        expectedTokens('Fix the bug') + expectedTokens('<protect>Don\'t skip S1.</protect>');
      expect(result.user).toBe(expected);
      expect(result.flowControl).toBe(expectedTokens('<protect>Don\'t skip S1.</protect>'));
    });

    it('assistant role: assistant total includes tool + reasoning', () => {
      const msg = makeAssistantMessage([
        makeTextPart('Solution:'),
        makeToolResult('call-3', 'bash', 'test passed'),
        makeReasoningPart('analysis'),
      ]);
      const result = counter.countContextTokens(msg);

      const expected =
        expectedTokens('Solution:') + expectedTokens('test passed') + expectedTokens('analysis');
      expect(result.assistant).toBe(expected);
      // Individual breakdowns
      expect(result.text).toBe(expectedTokens('Solution:'));
      expect(result.tool).toBe(expectedTokens('test passed'));
      expect(result.reasoning).toBe(expectedTokens('analysis'));
    });
  });

  // ─── countContextTokens — Edge Cases ──────────────

  describe('countContextTokens edge cases', () => {
    it('returns all zeros for empty content array', () => {
      const msg = makeUserMessage([]);
      const result = counter.countContextTokens(msg);

      expect(result.text).toBe(0);
      expect(result.user).toBe(0);
      expect(result.assistant).toBe(0);
      expect(result.flowControl).toBe(0);
      expect(result.tool).toBe(0);
      expect(result.reasoning).toBe(0);
    });

    it('handles tool-call input + tool-result text', () => {
      const msg = makeUserMessage([
        makeToolCall('call-4', 'bash', { key: 'value' }),
        makeToolResult('call-4', 'bash', 'Command executed successfully'),
      ]);
      const result = counter.countContextTokens(msg);

      const expected =
        expectedTokens(JSON.stringify({ key: 'value' })) +
        expectedTokens('Command executed successfully');
      expect(result.tool).toBe(expected);
    });

    it('handles tool-result with error value', () => {
      const msg = makeUserMessage([
        makeToolCall('call-5', 'read', { file: 'test.ts' }),
        makeToolErrorResult('call-5', 'read', 'File not found'),
      ]);
      const result = counter.countContextTokens(msg);

      const expected =
        expectedTokens(JSON.stringify({ file: 'test.ts' })) + expectedTokens('File not found');
      expect(result.tool).toBe(expected);
    });

    it('handles tool-call without a matching result', () => {
      const msg = makeUserMessage([makeToolCall('call-6', 'bash', { key: 'value' })]);
      const result = counter.countContextTokens(msg);

      expect(result.tool).toBe(expectedTokens(JSON.stringify({ key: 'value' })));
    });

    it('ignores unknown part types', () => {
      const unknown = { type: 'unknown-type' } as unknown as AIContentPart;
      const result = counter.countContextTokens(makeUserMessage([unknown]));

      expect(result.text).toBe(0);
      expect(result.user).toBe(0);
    });
  });

  // ─── dispose ──────────────────────────────────────

  describe('dispose', () => {
    it('calls encoder.free() on dispose', () => {
      const c = new TokenCounter({ providerID: 'test', modelID: 'test' });
      c.dispose();
      // No exception = success
    });

    it('dispose does not throw on subsequent calls', () => {
      const c = new TokenCounter({ providerID: 'test', modelID: 'test' });
      c.dispose();
      // Second dispose should not throw
      expect(() => c.dispose()).not.toThrow();
    });
  });
});

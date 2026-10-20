/**
 * TokenCounter — multi-model token counting + source classification
 *
 * Distinguishes user/assistant by `message.role`, and flowControl/text/tool/reasoning
 * by content part `type` (V2 model: `{ role, content }`).
 * Auto-selects the correct tokenizer backend based on model.
 */
import type { AIContentPart } from '../core/types.js';
import type { MessagePack, TokenCount, ModelInfo, TokenizerBackend } from './types.js';
import { resolveBackend } from './model-registry.js';
import { logger } from '../core';

type ToolCallPart = Extract<AIContentPart, { type: 'tool-call' }>;
type ToolResultPart = Extract<AIContentPart, { type: 'tool-result' }>;
type ToolResultValue = ToolResultPart['result'];

const EMPTY_COUNT: TokenCount = {
  text: 0,
  user: 0,
  assistant: 0,
  flowControl: 0,
  tool: 0,
  reasoning: 0,
};

/** Read tool reading project regulation files (Constitution/Flow/Regulation) → flowControl */
function isFlowControlToolCall(part: ToolCallPart): boolean {
  if (part.name !== 'read') return false;
  const input = part.input;
  if (typeof input !== 'object' || input === null) return false;
  const filePath = (input as Record<string, unknown>)['filePath'];
  return typeof filePath === 'string' && /docs\/(regulation|flow)\//.test(filePath);
}

function stringifyValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined) return '';
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function serializeToolResult(result: ToolResultValue): string {
  switch (result.type) {
    case 'content':
      return result.value
        .map((entry) =>
          entry.type === 'text' ? entry.text : `${entry.name ?? ''} ${entry.uri}`.trim(),
        )
        .join('\n');
    case 'text':
    case 'json':
    case 'error':
      return stringifyValue(result.value);
    default:
      return stringifyValue(result);
  }
}

export class TokenCounter {
  private backend: TokenizerBackend;

  constructor(info: ModelInfo) {
    this.backend = resolveBackend(info);
    logger.info(`TokenCounter: provider=${info.providerID} model=${info.modelID}`);
  }

  /** Encode text and return token count. Empty/whitespace returns 0 directly. */
  countTokens(text: string): number {
    if (!text || !text.trim()) return 0;
    return this.backend.countTokens(text.replace(/<\|endoftext\|>/g, ''));
  }

  /**
   * Classify content-part token source by `type` and content.
   *
   * `flowControlToolCalls` carries the IDs of read-tool calls already classified as
   * flowControl, so their separate V2 `tool-result` parts stay in the same bucket
   * (V1 had a single combined tool part).
   */
  private classifyPartType(
    part: AIContentPart,
    flowControlToolCalls: ReadonlySet<string>,
  ): 'flowControl' | 'text' | 'tool' | 'reasoning' | null {
    switch (part.type) {
      case 'text':
        return part.text.includes('<protect>') ? 'flowControl' : 'text';
      case 'tool-call':
        return isFlowControlToolCall(part) ? 'flowControl' : 'tool';
      case 'tool-result':
        return flowControlToolCalls.has(part.id) ? 'flowControl' : 'tool';
      case 'reasoning':
        return 'reasoning';
      default:
        return null;
    }
  }

  /** Serialize one content part into the text that gets tokenized. */
  private extractPartText(part: AIContentPart): string {
    switch (part.type) {
      case 'text':
      case 'reasoning':
        return part.text;
      case 'tool-call':
        return stringifyValue(part.input);
      case 'tool-result':
        return serializeToolResult(part.result);
      default:
        return '';
    }
  }

  /**
   * Count tokens in a message and classify by source.
   */
  countContextTokens(message: MessagePack): TokenCount {
    const result: TokenCount = { ...EMPTY_COUNT };
    const content = message.message.content;
    if (content.length === 0) return result;

    const role = message.message.role;
    const flowControlToolCalls = new Set<string>();
    let totalTokens = 0;

    for (const part of content) {
      const source = this.classifyPartType(part, flowControlToolCalls);
      if (!source) continue;

      if (source === 'flowControl' && part.type === 'tool-call') {
        flowControlToolCalls.add(part.id);
      }

      const tokens = this.countTokens(this.extractPartText(part));
      if (tokens > 0) {
        result[source] += tokens;
        totalTokens += tokens;
      }
    }

    if (role === 'user') {
      result.user = totalTokens;
    } else if (role === 'assistant') {
      result.assistant = totalTokens;
    }

    return result;
  }

  /** Release backend resources */
  dispose(): void {
    this.backend.dispose();
  }
}

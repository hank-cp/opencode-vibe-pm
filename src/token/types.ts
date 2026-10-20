/**
 * Token counting module type definitions
 */
import type { AIMessage } from '../core/types.js';

/** Token count classified by 6 sources */
export interface TokenCount {
  user: number;
  assistant: number;

  text: number;
  flowControl: number;
  tool: number;
  reasoning: number;
}

/**
 * One outbound message from the V2 `context` hook.
 *
 * V1 used `{ info, parts }` (SDK message + parts). V2 flattens both into a single
 * `Message` (`{ role, content }`), so a pack simply wraps that message.
 */
export interface MessagePack {
  message: AIMessage;
}

/** LLM API telemetry data — aligned with V2 `TokenUsage.Info` */
export interface ApiTelemetry {
  input: number;
  output: number;
  reasoning: number;
  cache: {
    read: number;
    write: number;
  };
}

/** Model identifier — used to select the correct tokenizer */
export interface ModelInfo {
  providerID: string;
  modelID: string;
}

/** Tokenizer backend interface — each model family implements its own counting logic */
export interface TokenizerBackend {
  /** Encode text and return token count (empty/whitespace returns 0) */
  countTokens(text: string): number;
  /** Release backend resources */
  dispose(): void;
}

/**
 * Token counting module type definitions
 */
import type { Message, Part } from '@opencode-ai/sdk';

/** Token count classified by 6 sources */
export interface TokenCount {
  user: number;
  assistant: number;

  text: number;
  flowControl: number;
  tool: number;
  reasoning: number;
}

export interface MessagePack {
  info: Message;
  parts: Part[];
}

/** LLM API telemetry data — aligned with @opencode-ai/sdk tokens type */
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

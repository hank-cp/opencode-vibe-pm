/**
 * TiktokenBackend — OpenAI model tokenizer
 *
 * Uses tiktoken's built-in encoding_for_model() to auto-select the most accurate encoding.
 */
import { get_encoding, encoding_for_model, type Tiktoken, type TiktokenModel } from 'tiktoken';
import type { TokenizerBackend } from '../types.js';

export class TiktokenBackend implements TokenizerBackend {
  private encoder: Tiktoken;

  constructor(modelID: string) {
    try {
      this.encoder = encoding_for_model(modelID as TiktokenModel);
    } catch {
      this.encoder = get_encoding('cl100k_base');
    }
  }

  countTokens(text: string): number {
    if (!text || !text.trim()) return 0;
    return this.encoder.encode(text).length;
  }

  dispose(): void {
    this.encoder.free();
  }
}

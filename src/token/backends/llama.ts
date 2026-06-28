/**
 * LlamaBackend — Llama model tokenizer
 *
 * Auto-selects llama-tokenizer-js (Llama 1/2) or llama3-tokenizer-js (Llama 3) by modelID.
 */
import llamaTokenizer from 'llama-tokenizer-js';
import llama3Tokenizer from 'llama3-tokenizer-js';
import type { TokenizerBackend } from '../types.js';

export class LlamaBackend implements TokenizerBackend {
  private mode: 'llama2' | 'llama3';

  constructor(modelID: string) {
    this.mode = modelID.includes('llama-3') || modelID.includes('llama3') ? 'llama3' : 'llama2';
  }

  countTokens(text: string): number {
    if (!text || !text.trim()) return 0;
    const tokenizer = this.mode === 'llama3' ? llama3Tokenizer : llamaTokenizer;
    return tokenizer.encode(text).length;
  }

  dispose(): void {
    // No resources to release
  }
}

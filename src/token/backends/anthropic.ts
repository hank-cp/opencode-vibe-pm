/**
 * AnthropicBackend — Claude model tokenizer (approximation)
 *
 * ⚠️ Accuracy note: @anthropic-ai/tokenizer is no longer accurate for Claude 3+ models (~15-20% deviation).
 * For local approximation reference only; should not be used as a basis for cost calculation.
 */
import { countTokens } from '@anthropic-ai/tokenizer';
import type { TokenizerBackend } from '../types.js';

export class AnthropicBackend implements TokenizerBackend {
  countTokens(text: string): number {
    if (!text || !text.trim()) return 0;
    return countTokens(text);
  }

  dispose(): void {
    // No resources to release
  }
}

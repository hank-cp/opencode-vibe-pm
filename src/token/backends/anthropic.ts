/**
 * AnthropicBackend — Claude 模型 tokenizer（近似）
 *
 * ⚠️ 精度说明：@anthropic-ai/tokenizer 对 Claude 3+ 模型不再准确（~15-20% 偏差）。
 * 仅作本地近似参考，不应作为成本计算的依据。
 */
import { countTokens } from '@anthropic-ai/tokenizer';
import type { TokenizerBackend } from '../types.js';

export class AnthropicBackend implements TokenizerBackend {
  countTokens(text: string): number {
    if (!text || !text.trim()) return 0;
    return countTokens(text);
  }

  dispose(): void {
    // 无资源需释放
  }
}

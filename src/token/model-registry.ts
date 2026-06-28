/**
 * ModelRegistry — model → backend mapping table
 *
 * Selects the correct TokenizerBackend based on providerID + modelID.
 * Unknown models fall back to cl100k_base (OpenAI GPT-4 encoding).
 */
import type { ModelInfo, TokenizerBackend } from './types.js';
import { TiktokenBackend } from './backends/tiktoken.js';
import { AnthropicBackend } from './backends/anthropic.js';
import { LlamaBackend } from './backends/llama.js';

const C100K = 'cl100k_base';

function openai(modelID: string): TokenizerBackend {
  return new TiktokenBackend(modelID);
}

function anthropic(): TokenizerBackend {
  return new AnthropicBackend();
}

function llama(modelID: string): TokenizerBackend {
  return new LlamaBackend(modelID);
}

function fallback(): TokenizerBackend {
  return new TiktokenBackend(C100K);
}

/** Create the corresponding tokenizer backend based on model info */
export function resolveBackend(info: ModelInfo): TokenizerBackend {
  const provider = info.providerID?.toLowerCase() ?? '';
  const model = info.modelID?.toLowerCase() ?? '';

  if (provider === 'openai') return openai(info.modelID);
  if (provider === 'anthropic') return anthropic();
  if (provider === 'meta' || model.includes('llama')) return llama(info.modelID);
  if (provider === 'deepseek') return fallback();

  return fallback();
}

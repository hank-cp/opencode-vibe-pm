/**
 * ModelRegistry — model → backend 映射表
 *
 * 根据 providerID + modelID 选择正确的 TokenizerBackend。
 * 未知模型回退到 cl100k_base（OpenAI GPT-4 编码）。
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

/** 根据 model 信息创建对应的 tokenizer backend */
export function resolveBackend(info: ModelInfo): TokenizerBackend {
  const provider = info.providerID?.toLowerCase() ?? '';
  const model = info.modelID?.toLowerCase() ?? '';

  if (provider === 'openai') return openai(info.modelID);
  if (provider === 'anthropic') return anthropic();
  if (provider === 'meta' || model.includes('llama')) return llama(info.modelID);
  if (provider === 'deepseek') return fallback();

  return fallback();
}

/**
 * Token 计数模块类型定义
 */
import type { Message, Part } from '@opencode-ai/sdk';

/** 按 6 来源分类的 Token 计数 */
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

/** LLM API 遥测数据 — 对齐 @opencode-ai/sdk 的 tokens 类型 */
export interface ApiTelemetry {
  input: number;
  output: number;
  reasoning: number;
  cache: {
    read: number;
    write: number;
  };
}

/** 模型标识 — 用于选择正确的 tokenizer */
export interface ModelInfo {
  providerID: string;
  modelID: string;
}

/** Tokenizer 后端接口 — 每个模型家族实现自己的计数逻辑 */
export interface TokenizerBackend {
  /** 编码文本并返回 token 数（空/空白返回 0） */
  countTokens(text: string): number;
  /** 释放后端资源 */
  dispose(): void;
}

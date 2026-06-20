/**
 * Token 计数模块类型定义
 */
import type {Message, Part} from "@opencode-ai/sdk";

/** 按 6 来源分类的 Token 计数 */
export interface TokenCount {
  text: number;
  user: number;
  assistant: number;
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

/**
 * TokenCounter — 基于 tiktoken 的 Token 计数 + 来源分类
 *
 * 按 message.info.role 区分 user/assistant，按 part.type 区分 flowControl/text/tool/reasoning。
 */

import {get_encoding, type Tiktoken, type TiktokenEncoding} from "tiktoken";
import type {Part} from "@opencode-ai/sdk";
import type {MessagePack, TokenCount} from "./types.js";

const EMPTY_COUNT: TokenCount = {
  text: 0, user: 0, assistant: 0, flowControl: 0, tool: 0, reasoning: 0,
};

export class TokenCounter {
  private encoder: Tiktoken;

  /**
   * @param modelEncoding tiktoken 编码名称，默认 "cl100k_base"（GPT-4 兼容）
   */
  constructor(modelEncoding: TiktokenEncoding = "cl100k_base") {
    this.encoder = get_encoding(modelEncoding);
  }

  /**
   * 编码文本并返回 token 数。
   * 空字符串/仅空白字符串直接返回 0，跳过编码。
   */
  countTokens(text: string): number {
    if (!text || !text.trim()) return 0;
    return this.encoder.encode(text).length;
  }

  /**
   * 根据 part.type 和内容分类 part token 来源。
   *
   * - flowControl: part.type === "text" && text 含 `<protect>`
   * - text:        part.type === "text" && text 不含 `<protect>`
   * - tool:        part.type === "tool"
   * - reasoning:   part.type === "reasoning"
   */
  private classifyPartType(part: Part): "flowControl" | "text" | "tool" | "reasoning" | null {
    if (part.type === "text") {
      const pt = part as { type: "text"; text: string };
      if (pt.text?.includes("<protect>")) return "flowControl";
      return "text";
    }
    if (part.type === "tool") return "tool";
    if (part.type === "reasoning") return "reasoning";
    return null;
  }

  /**
   * 计数消息中的 token 并按来源分类。
   *
   * user/assistant 按 message.info.role 区分。
   * flowControl/text/tool/reasoning 按 part.type 和内容区分。
   */
  countContextTokens(message: MessagePack): TokenCount {
    const result: TokenCount = { ...EMPTY_COUNT };
    if (!message.parts || message.parts.length === 0) return result;

    const role = message.info.role;
    let totalTokens = 0;

    for (const part of message.parts) {
      const source = this.classifyPartType(part);
      if (!source) continue;

      let tokenText = "";
      if (part.type === "text") {
        tokenText = (part as { text?: string }).text ?? "";
      } else if (part.type === "tool") {
        const tp = part as { type: "tool"; text?: string; args?: unknown; state?: { input?: unknown; output?: string; error?: string } };
        if (tp.text) {
          tokenText = tp.text;
        } else if (tp.state) {
          const pieces: string[] = [];
          if (tp.state.input !== undefined) {
            pieces.push(typeof tp.state.input === "string" ? tp.state.input : JSON.stringify(tp.state.input));
          }
          if (tp.state.output) pieces.push(tp.state.output);
          if (tp.state.error) pieces.push(tp.state.error);
          tokenText = pieces.join("\n");
        } else if (tp.args) {
          tokenText = JSON.stringify(tp.args);
        }
      } else if (part.type === "reasoning") {
        tokenText = (part as { text?: string }).text ?? "";
      }

      const tokens = this.countTokens(tokenText);
      if (tokens > 0) {
        result[source] += tokens;
        totalTokens += tokens;
      }
    }

    if (role === "user") {
      result.user = totalTokens;
    } else if (role === "assistant") {
      result.assistant = totalTokens;
    }

    return result;
  }

  /** 释放 tiktoken encoder 资源 */
  dispose(): void {
    this.encoder.free();
  }
}

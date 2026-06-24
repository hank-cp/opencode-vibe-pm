/**
 * TokenCounter — 多模型 Token 计数 + 来源分类
 *
 * 按 message.info.role 区分 user/assistant，按 part.type 区分 flowControl/text/tool/reasoning。
 * 根据 model 自动选择正确的 tokenizer backend。
 */
import type {Part, ToolPart} from "@opencode-ai/sdk";
import type {MessagePack, TokenCount, ModelInfo, TokenizerBackend} from "./types.js";
import {resolveBackend} from "./model-registry.js";
import {logger} from "../core";

const EMPTY_COUNT: TokenCount = {
  text: 0, user: 0, assistant: 0, flowControl: 0, tool: 0, reasoning: 0,
};

export class TokenCounter {
  private backend: TokenizerBackend;

  constructor(info: ModelInfo) {
    this.backend = resolveBackend(info);
    logger.info(`TokenCounter: provider=${info.providerID} model=${info.modelID}`);
  }

  /** 编码文本并返回 token 数。空/空白直接返回 0。 */
  countTokens(text: string): number {
    if (!text || !text.trim()) return 0;
    return this.backend.countTokens(text.replace(/<\|endoftext\|>/g, ''));
  }

  /**
   * 根据 part.type 和内容分类 part token 来源。
   */
  private classifyPartType(part: Part): "flowControl" | "text" | "tool" | "reasoning" | null {
    if (part.type === "text") {
      const pt = part as { type: "text"; text: string };
      if (pt.text?.includes("<protect>")) return "flowControl";
      return "text";
    }
    if (part.type === "tool") {
      // Read 工具读取项目规则文件（Constitution/Flow/Regulation）→ flowControl
      const tp = part as ToolPart;
      if (tp.tool === "read") {
        const input = tp.state?.input as Record<string, unknown> | undefined;
        const filePath = input?.filePath;
        if (typeof filePath === "string" && /docs\/(regulation|flow)\//.test(filePath)) {
          return "flowControl";
        }
      }
      return "tool";
    }
    if (part.type === "reasoning") return "reasoning";
    return null;
  }

  /**
   * 计数消息中的 token 并按来源分类。
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

  /** 释放 backend 资源 */
  dispose(): void {
    this.backend.dispose();
  }
}

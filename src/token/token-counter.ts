/**
 * TokenCounter — 基于 tiktoken 的 Token 计数 + 来源分类
 *
 * 在 messages.transform 和 chat.message hook 中调用，
 * 按 6 个来源（System/FlowControl/User/Assistant/Tool/Reasoning）分类计数。
 * 支持 FlowControl 增量化拆分（通过 originalParts 差值计算）。
 */

import { get_encoding, type Tiktoken, type TiktokenEncoding } from "tiktoken";
import type { TokenSource } from "../memory/types.js";
import type { TokenCountResult, PartInfo } from "./types.js";

/** 空 TokenCountResult 常量，避免在异常路径中反复构造 */
const EMPTY_RESULT: TokenCountResult = { bySource: {}, total: 0 };

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
   * 分类单个 part：根据 type/role/content 判断来源。
   *
   * 分类优先级：
   * 1. isControlPrompt 标记 → FlowControl
   * 2. text 含 `<pm-control-rules>` 或 `<protect>` → FlowControl
   * 3. role === "system" → System
   * 4. role === "user" → User
   * 5. role === "assistant" 且含 thinking/reasoning → Reasoning
   * 6. role === "assistant" → Assistant
   * 7. type === "tool" 或 role === "tool" → Tool
   * 8. 其他 → System（兜底）
   */
  classifyPart(part: PartInfo): TokenSource {
    const text = part.text ?? "";

    // 1. isControlPrompt 显式标记
    if (part.isControlPrompt) return "FlowControl";

    // 2. 文本内容含控制标记
    if (
      text.includes("<pm-control-rules>") ||
      text.includes("<protect>")
    ) {
      return "FlowControl";
    }

    // 3–6. 按 role 分类
    if (part.role === "system") return "System";
    if (part.role === "user") return "User";

    if (part.role === "assistant") {
      if (
        text.toLowerCase().includes("thinking") ||
        text.toLowerCase().includes("reasoning")
      ) {
        return "Reasoning";
      }
      return "Assistant";
    }

    // 7. Tool
    if (part.type === "tool" || part.role === "tool") return "Tool";

    // 8. 兜底：无法分类的归入 System
    return "System";
  }

  /**
   * 批量编码 parts 并按来源聚合 token 计数。
   */
  private countParts(parts: PartInfo[]): Record<string, number> {
    const bySource: Record<string, number> = {};
    for (const part of parts) {
      const source = this.classifyPart(part);
      let tokenText = part.text ?? "";
      if (!tokenText && part.args) {
        tokenText = JSON.stringify(part.args);
      }
      const tokens = this.countTokens(tokenText);
      bySource[source] = (bySource[source] ?? 0) + tokens;
    }
    return bySource;
  }

  /**
   * 计数 prompt side token（在 messages.transform 中调用）。
   *
   * FlowControl 增量化拆分策略：
   *   - 有 originalParts 时：分别计数 originalParts（不含 FlowControl）和 parts（含 FlowControl），
   *     差值作为 FlowControl 的 token 贡献。
   *   - 无 originalParts 时：直接按 classifyPart 分类计数。
   *
   * @param parts 注入 FlowControl 后的消息 parts 数组
   * @param originalParts 注入 FlowControl 之前的原始 parts（用于增量化拆分）
   */
  countPromptTokens(
    parts: PartInfo[],
    originalParts?: PartInfo[],
  ): TokenCountResult {
    // 空数组直接返回
    if (!parts || parts.length === 0) return EMPTY_RESULT;

    if (!originalParts || originalParts.length === 0) {
      // 无 originalParts → 直接分类计数
      const bySource = this.countParts(parts);
      const total = Object.values(bySource).reduce((a, b) => a + b, 0);
      return { bySource, total };
    }

    // 有 originalParts → 增量化拆分
    // Step 1: 计数 originalParts（不含 FlowControl）
    const originalBySource = this.countParts(originalParts);
    // Step 2: 计数 parts（含 FlowControl）
    const fullBySource = this.countParts(parts);

    // Step 3: 以 originalParts 的分类结果为基准
    const result: Record<string, number> = { ...originalBySource };

    // Step 4: User token 保持原始值（不含 FlowControl）
    result["User"] = originalBySource["User"] ?? 0;

    // Step 5: FlowControl token = 显式分类出的 FlowControl + （含 FC 的 User 减去原始 User 的差值）
    const directFC = fullBySource["FlowControl"] ?? 0;
    const fullUser = fullBySource["User"] ?? 0;
    const originalUser = originalBySource["User"] ?? 0;
    const diffFC = Math.max(0, fullUser - originalUser);
    result["FlowControl"] = (result["FlowControl"] ?? 0) + directFC + diffFC;

    // Step 6: 累加非 User 非 FlowControl 的来源增量
    for (const [source, tokens] of Object.entries(fullBySource)) {
      if (source === "User" || source === "FlowControl") continue;
      result[source] = (result[source] ?? 0) + tokens;
    }

    const total = Object.values(result).reduce((a, b) => a + b, 0);
    return { bySource: result, total };
  }

  /**
   * 计数 completion side token（在 chat.message 中调用）。
   *
   * 仅对 completion 侧的 parts 分类计数（Assistant/Tool/Reasoning）。
   */
  countCompletionTokens(parts: PartInfo[]): TokenCountResult {
    if (!parts || parts.length === 0) return EMPTY_RESULT;

    const bySource = this.countParts(parts);
    const total = Object.values(bySource).reduce((a, b) => a + b, 0);
    return { bySource, total };
  }

  /** 释放 tiktoken encoder 资源 */
  dispose(): void {
    this.encoder.free();
  }
}

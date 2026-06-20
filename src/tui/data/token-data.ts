/**
 * Token 数据加载
 *
 * 从 IMemorySystem 加载 Session 级 Token 分布（来源 + 步骤）。
 * Session 级数据来自 session_tokens 表，应用展示公式进行校准。
 * 步骤级数据来自 flowMetrics 聚合。
 */

import type { IMemorySystem, SessionTokenMetrics, TokenSource } from "../../memory/types.js";
import type { TokenData, TokenSourceEntry } from "../types.js";

/**
 * 应用展示公式：将 session_tokens 原始数据转换为 TUI 展示值（4 来源）。
 *
 * - TOTAL  = if api has data → apiInput + apiOutput;  else → text + user + assistant
 * - FLOW_CONTROL = flowControl * scaleFactor
 * - TEXT = text * scaleFactor
 * - TOOL = tool * scaleFactor
 * - REASONING = reasoning * scaleFactor
 */
function applyDisplayFormulas(m: SessionTokenMetrics): {
  totalTokens: number;
  sourceBreakdown: TokenSourceEntry[];
} {
  const { user, assistant, flowControl, text, tool, reasoning } = m;
  const { scaleFactor } = m;

  const totalTokens = (user + assistant) * scaleFactor;

  const sourceBreakdown: TokenSourceEntry[] = [
    { source: "FlowControl", tokens: Math.round(flowControl * scaleFactor) },
    { source: "Text", tokens: Math.round(text * scaleFactor) },
    { source: "Tool", tokens: Math.round(tool * scaleFactor) },
    { source: "Reasoning", tokens: Math.round(reasoning * scaleFactor) },
  ];

  return { totalTokens, sourceBreakdown };
}

/**
 * 加载指定 session 的 Token 分布数据。
 *
 * Session 级 Token 从 session_tokens 表读取并应用展示公式。
 * 步骤级 Token 从 flowMetrics 聚合读取（不变）。
 */
export async function loadTokenData(
  memory: IMemorySystem,
  sessionId: string,
): Promise<TokenData> {
  const [sessionMetrics, stepBreakdown] = await Promise.all([
    memory.getSessionTokens(sessionId),
    memory.getStepTokenBreakdown(sessionId),
  ]);

  if (sessionMetrics) {
    const { totalTokens, sourceBreakdown } = applyDisplayFormulas(sessionMetrics);
    const cachedTokens = sessionMetrics.apiCacheRead + sessionMetrics.apiCacheWrite;
    const uncachedTokens = sessionMetrics.apiInput + sessionMetrics.apiOutput + sessionMetrics.apiReasoning;
    return { totalTokens, sourceBreakdown, stepBreakdown, cachedTokens, uncachedTokens };
  }

  return {
    totalTokens: 0,
    sourceBreakdown: [],
    stepBreakdown,
    cachedTokens: 0,
    uncachedTokens: 0,
  };
}

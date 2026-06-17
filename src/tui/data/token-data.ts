/**
 * Token 数据加载
 *
 * 从 IMemorySystem 加载 Session 级 Token 分布（来源 + 步骤）。
 */

import type { IMemorySystem } from "../../memory/types.js";
import type { TokenData } from "../types.js";

/**
 * 加载指定 session 的 Token 分布数据。
 *
 * 同时获取来源级和步骤级 Token 分解，计算总量。
 */
export async function loadTokenData(
  memory: IMemorySystem,
  sessionId: string,
): Promise<TokenData> {
  const [sourceBreakdown, stepBreakdown] = await Promise.all([
    memory.getSourceTokenBreakdown(sessionId),
    memory.getStepTokenBreakdown(sessionId),
  ]);

  const totalTokens = sourceBreakdown.reduce(
    (sum, entry) => sum + entry.tokens,
    0,
  );

  return { totalTokens, sourceBreakdown, stepBreakdown };
}

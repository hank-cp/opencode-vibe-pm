/**
 * Token data loading
 *
 * Loads Session-level token distribution (source + step) from IMemorySystem.
 * Session-level data comes from the session_tokens table, calibrated with display formulas.
 * Step-level data comes from flowMetrics aggregation.
 */

import type { IMemorySystem, SessionTokenMetrics } from '../../memory';
import type { TokenData, TokenSourceEntry } from '../types.js';

/**
 * Apply display formulas: convert session_tokens raw data to TUI display values (4 sources).
 *
 * - TOTAL  = (user + assistant) * scaleFactor
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
    { source: 'FlowControl', tokens: Math.round(flowControl * scaleFactor) },
    { source: 'Text', tokens: Math.round(text * scaleFactor) },
    { source: 'Tool', tokens: Math.round(tool * scaleFactor) },
    { source: 'Reasoning', tokens: Math.round(reasoning * scaleFactor) },
  ];

  return { totalTokens, sourceBreakdown };
}

/**
 * Load token distribution data for the specified session.
 *
 * Session-level tokens are read from the session_tokens table with display formulas applied.
 * Step-level tokens are read from flowMetrics aggregation (unchanged).
 */
export async function loadTokenData(memory: IMemorySystem, sessionId: string): Promise<TokenData> {
  const [sessionMetrics, stepBreakdown, subagentMetrics] = await Promise.all([
    memory.getSessionTokens(sessionId),
    memory.getStepTokenBreakdown(sessionId),
    memory.getSubagentTokens(sessionId),
  ]);

  if (sessionMetrics) {
    const { totalTokens: sessionTotal, sourceBreakdown } = applyDisplayFormulas(sessionMetrics);
    const cachedTokens = sessionMetrics.apiCacheRead + sessionMetrics.apiCacheWrite;
    const uncachedTokens =
      sessionMetrics.apiInput + sessionMetrics.apiOutput + sessionMetrics.apiReasoning;

    const subagentTotal = subagentMetrics.reduce((sum, s) => sum + s.user + s.assistant, 0);
    if (subagentTotal > 0) {
      sourceBreakdown.push({ source: 'SubAgent', tokens: subagentTotal });
    }

    return {
      totalTokens: sessionTotal + subagentTotal,
      sourceBreakdown,
      stepBreakdown,
      cachedTokens,
      uncachedTokens,
    };
  }

  return {
    totalTokens: 0,
    sourceBreakdown: [],
    stepBreakdown,
    cachedTokens: 0,
    uncachedTokens: 0,
  };
}

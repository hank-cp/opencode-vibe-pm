/**
 * TUI component shared type definitions
 *
 * Defines TaskStatusData, TokenData, and color mapping constants.
 */

import { RGBA } from '@opentui/core';

// ─── Task Status ───

export interface TaskStatusData {
  type: 'active' | 'last' | 'empty';
  flow?: string;
  currentStep?: string;
  currentStepName?: string;
  startAt?: string;
  endAt?: string;
  /** Formatted elapsed time e.g. "22min" / "1h 15min" */
  elapsed?: string;
}

// ─── Token Data ───

export interface TokenData {
  /** Session-level total tokens — prefers LLM API returned data (apiInput + apiOutput), falls back to local tiktoken sum */
  totalTokens: number;
  sourceBreakdown: TokenSourceEntry[];
  stepBreakdown: StepTokenEntry[];
  /** Cache token count = apiCacheRead + apiCacheWrite */
  cachedTokens: number;
  /** Cache percentage baseline = user + assistant (role dimension sum in TokenCount) */
  uncachedTokens: number;
}

export interface TokenSourceEntry {
  source: string;
  tokens: number;
}

export interface StepTokenEntry {
  step: string;
  stepName: string;
  stepInCount: number;
  tokensConsumed: number;
}

// ─── Color Mapping ───

/**
 * Source → color mapping (fixed, inspired by magic-context cool/warm color design).
 *
 * Cool: System (blue), FlowControl (cyan)
 * Warm: User (orange), Assistant (green), Tool (purple), Reasoning (gray)
 */
export const SOURCE_COLORS: Record<string, RGBA> = {
  FlowControl: RGBA.fromInts(54, 176, 200), // #36B0C8 cool cyan
  Text: RGBA.fromInts(74, 144, 217), // #4A90D9 cool blue
  Tool: RGBA.fromInts(176, 123, 237), // #B07BED warm purple
  Reasoning: RGBA.fromInts(106, 104, 255), // #9B9B9B warm blue
  SubAgent: RGBA.fromInts(255, 173, 51), // #FFAD33 warm orange
};

// ─── Helpers ───

/** Format elapsed time as a human-readable string */
export function formatElapsed(startAt: string, endAt?: string): string {
  const start = new Date(startAt).getTime();
  const end = endAt ? new Date(endAt).getTime() : Date.now();
  const ms = Math.max(0, end - start);
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) {
    return `${minutes}min`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}min`;
}

/** Format token count to compact form (e.g. 12.5K, 16.4M) */
export function compactTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}K`;
  }
  return String(tokens);
}

/**
 * Calculate the visual width of a string (CJK characters count as 2 columns, ASCII as 1).
 *
 * Used for manual string padding as a substitute for flexbox layout.
 * Coverage: CJK unified ideographs, CJK punctuation, fullwidth characters.
 */
export function visualWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    w += /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(ch) ? 2 : 1;
  }
  return w;
}

/**
 * CJK-aware justified alignment.
 *
 * Pads spaces between left and right so the total visual width equals the specified width.
 * When content already exceeds width, at least 1 space separator is preserved.
 *
 * Used as a flexbox layout alternative to avoid right-side text truncation in narrow sidebars.
 */
export function justify(left: string, right: string, width: number): string {
  const gap = width - visualWidth(left) - visualWidth(right);
  const pad = Math.max(1, gap);
  return `${left}${' '.repeat(pad)}${right}`;
}

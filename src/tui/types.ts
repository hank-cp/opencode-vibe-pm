/**
 * TUI 组件共享类型定义
 *
 * 定义 TaskStatusData、TokenData、ColorSegment 及颜色映射常量。
 */

import { RGBA } from "@opentui/core";
import type { TokenSource } from "../memory/types.js";

// ─── Task Status ───

export interface TaskStatusData {
  type: "active" | "last" | "empty";
  flow?: string;
  currentStep?: string;
  currentStepName?: string;
  startAt?: string;
  endAt?: string;
  /** 格式化耗时 "22min" / "1h 15min" */
  elapsed?: string;
  specRef?: string;
  planRef?: string;
}

// ─── Token Data ───

export interface TokenData {
  totalTokens: number;
  sourceBreakdown: TokenSourceEntry[];
  stepBreakdown: StepTokenEntry[];
}

export interface TokenSourceEntry {
  source: TokenSource;
  tokens: number;
}

export interface StepTokenEntry {
  step: string;
  stepName: string;
  stepInCount: number;
  tokensConsumed: number;
}

// ─── Color Segment ───

export interface ColorSegment {
  source: TokenSource;
  tokens: number;
  percentage: number;
  color: RGBA;
}

// ─── Color Mapping ───

/**
 * 来源 → 颜色映射（固定，参考 magic-context 冷暖色调设计）。
 *
 * 冷色：System（蓝）、FlowControl（青）
 * 暖色：User（橙）、Assistant（绿）、Tool（紫）、Reasoning（灰）
 */
export const SOURCE_COLORS: Record<TokenSource, RGBA> = {
  System:      RGBA.fromInts(74, 144, 217),     // #4A90D9
  FlowControl: RGBA.fromInts(54, 176, 200),     // #36B0C8
  User:        RGBA.fromInts(245, 166, 35),      // #F5A623
  Assistant:   RGBA.fromInts(126, 211, 33),      // #7ED321
  Tool:        RGBA.fromInts(176, 123, 237),     // #B07BED
  Reasoning:   RGBA.fromInts(155, 155, 155),     // #9B9B9B
};

// ─── Helpers ───

/** 格式化耗时为可读字符串 */
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

/** 格式化 Token 数为紧凑格式（如 12.5K, 16.4M） */
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
 * 计算字符串的可视宽度（CJK 字符计 2 列，ASCII 计 1 列）。
 *
 * 用于手动字符串填充，替代 flexbox 布局。
 * 覆盖范围：CJK 统一汉字、CJK 标点、全角字符。
 */
export function visualWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    w += /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(ch) ? 2 : 1;
  }
  return w;
}

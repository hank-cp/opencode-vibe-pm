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
}

// ─── Token Data ───

export interface TokenData {
  /** Session 级 Token 总量 — 优先使用 LLM API 返回数据 (apiInput + apiOutput)，兜底本地 tiktoken 合计 */
  totalTokens: number;
  sourceBreakdown: TokenSourceEntry[];
  stepBreakdown: StepTokenEntry[];
  /** Cache token 数 = apiCacheRead + apiCacheWrite */
  cachedTokens: number;
  /** Cache 百分比基准 = user + assistant（TokenCount 中的 role 维度总和） */
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
export const SOURCE_COLORS: Record<string, RGBA> = {
  FlowControl: RGBA.fromInts(54, 176, 200),     // #36B0C8 冷青
  Text:        RGBA.fromInts(74, 144, 217),     // #4A90D9 冷蓝
  Tool:        RGBA.fromInts(176, 123, 237),     // #B07BED 暖紫
  Reasoning:   RGBA.fromInts(106, 104, 255),     // #9B9B9B 暖蓝
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

/**
 * CJK 感知的两端对齐。
 *
 * 在 left 和 right 之间填充空格，使整行可视宽度达到指定 width。
 * 当内容已超出 width 时，至少保留 1 个空格分隔。
 *
 * 用于替代 flexbox 布局，避免窄宽度侧边栏中右侧文本被裁断。
 */
export function justify(left: string, right: string, width: number): string {
  const gap = width - visualWidth(left) - visualWidth(right);
  const pad = Math.max(1, gap);
  return `${left}${" ".repeat(pad)}${right}`;
}

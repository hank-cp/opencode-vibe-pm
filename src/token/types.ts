/**
 * Token 计数模块类型定义
 */

import type { TokenSource } from "../memory/types.js";

export interface TokenCountResult {
  /** 按来源分类的 token 数 */
  bySource: Record<string, number>;
  /** 总 token 数 */
  total: number;
}

export interface PartInfo {
  type: string;
  text?: string;
  role?: string;
  /** 是否包含 vibe-pm 控制提示 */
  isControlPrompt?: boolean;
}

/**
 * 日志工具
 *
 * console 封装 + [vibe-pm] 统一前缀，零外部依赖。
 */

import type { ILogger } from "./types.js";

const PREFIX = "[vibe-pm]";

export const logger: ILogger = {
  info: (...args: unknown[]) => console.log(PREFIX, ...args),
  warn: (...args: unknown[]) => console.warn(PREFIX, ...args),
  error: (...args: unknown[]) => console.error(PREFIX, ...args),
};

/**
 * 日志工具
 *
 * 写入文件而非 console，避免破坏 TUI。
 * 日志路径: ~/.config/vibe-pm/logs/daily/YYYY-MM-DD.log
 *
 * 参考: opencode-dynamic-context-pruning/lib/logger.ts
 */

import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import type { ILogger } from "./types.js";

// ─── 日志目录 ───

const LOG_DIR = join(
  process.env.XDG_CONFIG_HOME || join(homedir(), ".config"),
  "vibe-pm",
  "logs",
  "daily",
);

// ─── 启用/禁用 ───

let enabled = true;

export function setLogEnabled(v: boolean): void {
  enabled = v;
}

// ─── 内部工具 ───

/**
 * 从 Error.stack 提取调用方文件名（不含路径和扩展名）。
 * 跳过 logger.ts 自身帧。
 */
function getCallerFile(): string {
  const orig = Error.prepareStackTrace;
  try {
    const err = new Error();
    Error.prepareStackTrace = (_, stack) => stack;
    const stack = (err as unknown as { stack: NodeJS.CallSite[] }).stack;
    Error.prepareStackTrace = orig;

    for (let i = 2; i < stack.length; i++) {
      const fn = stack[i]?.getFileName();
      if (fn && !fn.includes("/logger.")) {
        const m = fn.match(/([^/\\]+)\.[tj]s$/);
        return m ? m[1] : fn;
      }
    }
    return "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * 将附加数据格式化为 key=value 字符串。
 * 支持: 对象、Error、字符串、基础类型。
 */
function formatData(data?: unknown): string {
  if (data === undefined || data === null) return "";
  if (typeof data === "string") return data;
  if (data instanceof Error) return `error=${data.message}`;
  if (typeof data === "object") {
    const parts: string[] = [];
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      if (v === undefined || v === null) continue;
      const str = typeof v === "object" ? JSON.stringify(v) : String(v);
      if (str.length < 100) {
        parts.push(`${k}=${str}`);
      }
    }
    return parts.join(" ");
  }
  return String(data);
}

// ─── 写入 ───

async function write(
  level: string,
  message: unknown,
  data?: unknown,
): Promise<void> {
  if (!enabled) return;

  try {
    if (!existsSync(LOG_DIR)) {
      await mkdir(LOG_DIR, { recursive: true });
    }

    const timestamp = new Date().toISOString();
    const component = getCallerFile();
    const dataStr = formatData(data);
    const line = `${timestamp} ${level.padEnd(5)} ${component}: ${message}${dataStr ? " | " + dataStr : ""}\n`;

    const logFile = join(
      LOG_DIR,
      `${new Date().toISOString().split("T")[0]}.log`,
    );
    await writeFile(logFile, line, { flag: "a" });
  } catch {
    // 静默失败 —— 日志不应导致应用崩溃
  }
}

// ─── Logger 实例 ───

export const logger: ILogger = {
  debug(...args: unknown[]) {
    void write("DEBUG", args[0], args[1]);
  },
  info(...args: unknown[]) {
    void write("INFO", args[0], args[1]);
  },
  warn(...args: unknown[]) {
    void write("WARN", args[0], args[1]);
  },
  error(...args: unknown[]) {
    void write("ERROR", args[0], args[1]);
  },
};

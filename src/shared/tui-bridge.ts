/**
 * 跨进程 TUI 数据桥接
 *
 * 主进程通过 writeTuiData() 写入状态数据到 .vibe-pm/tui-data.json。
 * TUI 进程通过 readTuiData() 直接读取文件（绕过 AxioDB 缓存问题）。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { TaskStatusData, TokenData } from "../tui/types.js";

export interface TuiData {
  taskStatus: TaskStatusData;
  tokenData: TokenData;
  updatedAt: number;
}

let dataDir: string | undefined;

export function initTuiBridge(dir: string): void {
  dataDir = dir;
}

export async function writeTuiData(data: Omit<TuiData, "updatedAt">): Promise<void> {
  if (!dataDir) return;
  try {
    const full: TuiData = { ...data, updatedAt: Date.now() };
    await fs.promises.writeFile(
      path.join(dataDir, "tui-data.json"),
      JSON.stringify(full),
      "utf-8",
    );
  } catch {
    // 静默——桥接文件写入是尽力而为的
  }
}

export function readTuiData(): TuiData | null {
  if (!dataDir) return null;
  try {
    const p = path.join(dataDir, "tui-data.json");
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, "utf-8");
    return JSON.parse(raw) as TuiData;
  } catch {
    return null;
  }
}

/**
 * 配置管理
 *
 * 从项目目录加载 .vibe-pm.json，支持默认值、合并覆盖、容错处理。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { PluginConfig } from "./types.js";
import { logger } from "./logger.js";

// ─── DEFAULT_CONFIG ───

export const DEFAULT_CONFIG: PluginConfig = {
  language: "zh-CN",
  dataDir: ".vibe-pm",
  autoAnalyze: true,
  contextInjection: {
    maxStepTokens: 0, // 0 = 不限制
    pruneIrrelevant: true,
  },
};

// ─── loadConfig ───

export function loadConfig(projectDir: string): PluginConfig {
  const configPath = path.join(projectDir, ".vibe-pm.json");

  if (!fs.existsSync(configPath)) {
    logger.info(`.vibe-pm.json not found, using defaults. Run /pm-init to configure.`);
    return { ...DEFAULT_CONFIG };
  }

  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<PluginConfig>;
    const merged = { ...DEFAULT_CONFIG, ...parsed };

    // 深度合并 contextInjection
    if (parsed.contextInjection) {
      merged.contextInjection = {
        ...DEFAULT_CONFIG.contextInjection,
        ...parsed.contextInjection,
      };
    }

    return merged;
  } catch (err) {
    logger.warn(
      `Failed to parse .vibe-pm.json, using defaults:`,
      err instanceof Error ? err.message : err,
    );
    return { ...DEFAULT_CONFIG };
  }
}

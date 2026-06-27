/**
 * 配置管理
 *
 * 从项目目录加载 vibe-pm/config.json，支持默认值、合并覆盖、容错处理。
 * 启动时自动创建默认配置文件。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { PluginConfig } from "./types.js";
import { logger } from "./logger.js";

// ─── DEFAULT_CONFIG ───

export const DEFAULT_CONFIG: PluginConfig = {
  language: "en-US",
  dataDir: ".vibe-pm",
  autoAnalyze: true,
  contextInjection: {
    maxStepTokens: 0, // 0 = 不限制
    pruneIrrelevant: true,
  },
  debug: {
    logFullRequest: false,
  },
};

// ─── 公开 API ───

const PROJECT_CONFIG_REL = path.join("vibe-pm", "config.json");

export function loadConfig(projectDir: string): PluginConfig {
  const configPath = path.join(projectDir, PROJECT_CONFIG_REL);

  if (!fs.existsSync(configPath)) {
    logger.info(`vibe-pm/config.json not found, using defaults.`);
    return { ...DEFAULT_CONFIG };
  }

  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<PluginConfig>;
    const merged = { ...DEFAULT_CONFIG, ...parsed };

    if (parsed.contextInjection) {
      merged.contextInjection = {
        ...DEFAULT_CONFIG.contextInjection,
        ...parsed.contextInjection,
      };
    }

    return merged;
  } catch (err) {
    logger.warn(
      `Failed to parse vibe-pm/config.json, using defaults:`,
      err instanceof Error ? err.message : err,
    );
    return { ...DEFAULT_CONFIG };
  }
}

export function writeConfig(
  projectDir: string,
  config: PluginConfig,
): void {
  const configPath = path.join(projectDir, PROJECT_CONFIG_REL);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(
    configPath,
    JSON.stringify(config, null, 2),
    "utf-8",
  );
  logger.info("vibe-pm/config.json written");
}

export function ensureDefaultConfig(projectDir: string): boolean {
  const configPath = path.join(projectDir, PROJECT_CONFIG_REL);
  if (fs.existsSync(configPath)) return false;

  writeConfig(projectDir, DEFAULT_CONFIG);
  logger.info("vibe-pm/config.json created with default values");
  return true;
}

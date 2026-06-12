/**
 * 配置管理测试
 *
 * 测试文件: tests/core/config.test.ts
 * 关联 Spec: vibe-pm-plugin-core.md
 * Setup: 创建临时目录和 .vibe-pm.json 文件，测试后清理
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  loadConfig,
  DEFAULT_CONFIG,
  ensureDefaultConfig,
  writeConfig,
} from "../../src/core/config.js";

// Mock logger
vi.mock("../../src/core/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { logger } from "../../src/core/logger.js";

describe("loadConfig", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-pm-test-config-"));
    vi.clearAllMocks();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loadConfig_defaults: 返回 DEFAULT_CONFIG 当 .vibe-pm.json 不存在", () => {
    const result = loadConfig(tmpDir);

    expect(result).toEqual(DEFAULT_CONFIG);
    expect(logger.info).toHaveBeenCalled();
  });

  it("loadConfig_override: 部分覆盖时返回合并后的配置", () => {
    const config = { language: "en-US" };
    fs.writeFileSync(
      path.join(tmpDir, ".vibe-pm.json"),
      JSON.stringify(config),
    );

    const result = loadConfig(tmpDir);

    expect(result.language).toBe("en-US");
    expect(result.dataDir).toBe(DEFAULT_CONFIG.dataDir);
    expect(result.autoAnalyze).toBe(DEFAULT_CONFIG.autoAnalyze);
    expect(result.contextInjection).toEqual(DEFAULT_CONFIG.contextInjection);
  });

  it("loadConfig_invalid_json: 非法 JSON 时返回 DEFAULT_CONFIG + 记录 warning", () => {
    fs.writeFileSync(
      path.join(tmpDir, ".vibe-pm.json"),
      "{ invalid json content",
    );

    const result = loadConfig(tmpDir);

    expect(result).toEqual(DEFAULT_CONFIG);
    expect(logger.warn).toHaveBeenCalled();
  });

  it("loadConfig_deep_merge: contextInjection 支持深度合并", () => {
    const config = {
      contextInjection: { maxStepTokens: 8000 },
    };
    fs.writeFileSync(
      path.join(tmpDir, ".vibe-pm.json"),
      JSON.stringify(config),
    );

    const result = loadConfig(tmpDir);

    expect(result.contextInjection.maxStepTokens).toBe(8000);
    expect(result.contextInjection.pruneIrrelevant).toBe(
      DEFAULT_CONFIG.contextInjection.pruneIrrelevant,
    );
  });
});

describe("ensureDefaultConfig", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-pm-test-ecfg-"));
    vi.clearAllMocks();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("ensureDefaultConfig_creates_when_missing: 不存在时创建默认配置", () => {
    const configPath = path.join(tmpDir, ".vibe-pm.json");
    expect(fs.existsSync(configPath)).toBe(false);

    const created = ensureDefaultConfig(tmpDir);

    expect(created).toBe(true);
    expect(fs.existsSync(configPath)).toBe(true);
    const content = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    expect(content).toEqual(DEFAULT_CONFIG);
  });

  it("ensureDefaultConfig_skips_when_exists: 已存在时跳过", () => {
    const configPath = path.join(tmpDir, ".vibe-pm.json");
    fs.writeFileSync(configPath, JSON.stringify({ language: "en-US" }));

    const created = ensureDefaultConfig(tmpDir);

    expect(created).toBe(false);
    const content = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    expect(content.language).toBe("en-US");
  });
});

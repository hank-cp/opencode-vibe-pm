/**
 * Configuration Management Tests
 *
 * Test file: tests/core/config.test.ts
 * Related Spec: vibe-pm-plugin-core.md
 * Setup: creates temp directory and vibe-pm/config.json, cleans up after test
 */

import { describe, it, expect, spyOn, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { loadConfig, DEFAULT_CONFIG, ensureDefaultConfig } from '../../src/core/config.js';
import { logger } from '../../src/core/logger.js';

describe('loadConfig', () => {
  let tmpDir: string;
  let infoSpy: ReturnType<typeof spyOn>;
  let warnSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-pm-test-config-'));
    infoSpy = spyOn(logger, 'info');
    warnSpy = spyOn(logger, 'warn');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loadConfig_defaults: returns DEFAULT_CONFIG when vibe-pm/config.json does not exist', () => {
    const result = loadConfig(tmpDir);

    expect(result).toEqual(DEFAULT_CONFIG);
    expect(infoSpy).toHaveBeenCalled();
  });

  it('loadConfig_override: returns merged config on partial override', () => {
    const config = { language: 'en-US' };
    const configDir = path.join(tmpDir, '.vibe-pm');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify(config));

    const result = loadConfig(tmpDir);

    expect(result.language).toBe('en-US');
    expect(result.dataDir).toBe(DEFAULT_CONFIG.dataDir);
    expect(result.autoAnalyze).toBe(DEFAULT_CONFIG.autoAnalyze);
    expect(result.contextInjection).toEqual(DEFAULT_CONFIG.contextInjection);
  });

  it('loadConfig_invalid_json: returns DEFAULT_CONFIG on invalid JSON + logs warning', () => {
    const configDir = path.join(tmpDir, '.vibe-pm');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'config.json'), '{ invalid json content');

    const result = loadConfig(tmpDir);

    expect(result).toEqual(DEFAULT_CONFIG);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('loadConfig_deep_merge: supports deep merge for contextInjection', () => {
    const config = {
      contextInjection: { maxStepTokens: 8000 },
    };
    const configDir = path.join(tmpDir, '.vibe-pm');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify(config));

    const result = loadConfig(tmpDir);

    expect(result.contextInjection.maxStepTokens).toBe(8000);
    expect(result.contextInjection.pruneIrrelevant).toBe(
      DEFAULT_CONFIG.contextInjection.pruneIrrelevant
    );
  });
});

describe('ensureDefaultConfig', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-pm-test-ecfg-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('ensureDefaultConfig_creates_when_missing: creates default config when missing', () => {
    const configPath = path.join(tmpDir, '.vibe-pm', 'config.json');
    expect(fs.existsSync(configPath)).toBe(false);

    const created = ensureDefaultConfig(tmpDir);

    expect(created).toBe(true);
    expect(fs.existsSync(configPath)).toBe(true);
    const content = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(content).toEqual(DEFAULT_CONFIG);
  });

  it('ensureDefaultConfig_skips_when_exists: skips when already exists', () => {
    const configPath = path.join(tmpDir, '.vibe-pm', 'config.json');
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({ language: 'en-US' }));

    const created = ensureDefaultConfig(tmpDir);

    expect(created).toBe(false);
    const content = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(content.language).toBe('en-US');
  });
});

/**
 * I18N 加载器测试
 *
 * 测试文件: tests/i18n/loader.test.ts
 * 关联 Spec: docs/spec/vibe-pm-i18n-support.md
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import {
  discoverLanguagePacks,
  getControlPromptTemplate,
  clearI18nCache,
} from '../../src/i18n/loader.js';

beforeEach(() => {
  clearI18nCache();
});

describe('discoverLanguagePacks', () => {
  it('discovers en-US and zh-CN from prompts files', () => {
    const packs = discoverLanguagePacks();
    expect(packs.length).toBeGreaterThanOrEqual(2);

    const locales = packs.map((p) => p.locale);
    expect(locales).toContain('en-US');
    expect(locales).toContain('zh-CN');
  });

  it('returns English label for en-US', () => {
    const packs = discoverLanguagePacks();
    const en = packs.find((p) => p.locale === 'en-US');
    expect(en).toBeDefined();
    expect(en!.label).toBe('English');
  });

  it('returns 中文 label for zh-CN', () => {
    const packs = discoverLanguagePacks();
    const zh = packs.find((p) => p.locale === 'zh-CN');
    expect(zh).toBeDefined();
    expect(zh!.label).toBe('中文');
  });

  it('caches result across multiple calls', () => {
    const a = discoverLanguagePacks();
    const b = discoverLanguagePacks();
    expect(a).toBe(b); // same reference
  });
});

describe('getControlPromptTemplate', () => {
  it('returns zh-CN template with Chinese content', () => {
    const tpl = getControlPromptTemplate('zh-CN');
    const prompt = tpl.buildControlPrompt('bug-fix');
    expect(prompt).toContain('<protect>');
    expect(prompt).toContain('流程执行规则');
    expect(prompt).toContain('红线');
    expect(prompt).toContain('步骤门禁');
  });

  it('returns en-US template with English content', () => {
    const tpl = getControlPromptTemplate('en-US');
    const prompt = tpl.buildControlPrompt('bug-fix');
    expect(prompt).toContain('<protect>');
    expect(prompt).toContain('Flow Execution Rules');
    expect(prompt).toContain('Red Lines');
    expect(prompt).toContain('Step Gates');
  });

  it('includes flow reference in prompt', () => {
    const tpl = getControlPromptTemplate('en-US');
    const prompt = tpl.buildControlPrompt('spec-driven-dev');
    expect(prompt).toContain('flow-spec-driven-dev.md');
  });

  it('falls back to en-US for unknown locale', () => {
    const tpl = getControlPromptTemplate('ja-JP');
    expect(tpl.locale).toBe('en-US');
  });

  it('buildFlowWarningPrompt returns English warning', () => {
    const tpl = getControlPromptTemplate('en-US');
    const warning = tpl.buildFlowWarningPrompt();
    expect(warning).toContain('Flow Violation Detected');
  });

  it('buildFlowWarningPrompt returns Chinese warning', () => {
    const tpl = getControlPromptTemplate('zh-CN');
    const warning = tpl.buildFlowWarningPrompt();
    expect(warning).toContain('流程违规检测');
  });
});

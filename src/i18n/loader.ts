/**
 * I18N 语言包加载器
 *
 * 提示词模板通过静态 import + 映射表实现，确保 Bundler（Bun.build）能正确打包。
 * 新增语言：在此文件添加静态 import 和映射条目即可。
 */

import enUS from "./prompts-en-US.js";
import zhCN from "./prompts-zh-CN.js";
import type { LanguagePack, Locale, PromptsI18n } from "./types.js";

// ─── 内置语言包映射 ───

const PROMPT_MAP: Record<string, PromptsI18n> = {
  "en-US": enUS,
  "zh-CN": zhCN,
};

const LOCALE_LABELS: Record<string, string> = {
  "en-US": "English",
  "zh-CN": "中文",
};

// ─── 缓存 ───

let _packsCache: LanguagePack[] | null = null;

// ─── discoverLanguagePacks ───

/**
 * 返回内置语言包列表，从 PROMPT_MAP 推导。
 * 结果内部缓存，多次调用返回同一引用。
 */
export function discoverLanguagePacks(): LanguagePack[] {
  if (_packsCache) return _packsCache;

  const packs: LanguagePack[] = [];
  for (const locale of Object.keys(PROMPT_MAP)) {
    packs.push({
      locale,
      label: LOCALE_LABELS[locale] ?? locale,
    });
  }

  _packsCache = packs;
  return packs;
}

// ─── getControlPromptTemplate ───

/**
 * 按 locale 获取 ControlPromptTemplate，未命中回退 en-US。
 * 通过静态映射表查找，无需动态 import。
 */
export function getControlPromptTemplate(locale: Locale): PromptsI18n {
  const template = PROMPT_MAP[locale] ?? PROMPT_MAP["en-US"];
  if (!template) {
    throw new Error(`Failed to load base prompt template for locale "${locale}"`);
  }
  return template;
}

/** 清除所有缓存（用于测试） */
export function clearI18nCache(): void {
  _packsCache = null;
}

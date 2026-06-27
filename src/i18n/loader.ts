/**
 * I18N 语言包加载器
 *
 * 语言包发现基于 prompts-{locale}.ts 文件名推导。
 * 提示词模板通过动态 import() 加载，未匹配回退 en-US。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ControlPromptTemplate, LanguagePack, Locale } from "./types.js";

// ─── 已知语言的标签映射 ───

const LOCALE_LABELS: Record<string, string> = {
  "en-US": "English",
  "zh-CN": "中文",
};

// ─── 缓存 ───

let _packsCache: LanguagePack[] | null = null;
const _promptCache = new Map<string, ControlPromptTemplate>();

// ─── discoverLanguagePacks ───

/**
 * 扫描 i18n 目录下 prompts-{locale}.ts 文件，推导可用语言列表。
 * 结果内部缓存，多次调用返回同一引用。
 */
export function discoverLanguagePacks(): LanguagePack[] {
  if (_packsCache) return _packsCache;

  const dir = path.dirname(fileURLToPath(import.meta.url));
  const packs: LanguagePack[] = [];

  try {
    const entries = fs.readdirSync(dir);
    for (const entry of entries) {
      const match = entry.match(/^prompts-(.+)\.ts$/);
      if (!match) continue;
      const locale = match[1];
      packs.push({
        locale,
        label: LOCALE_LABELS[locale] ?? locale,
      });
    }
  } catch {
    // 目录不可读，返回空列表
  }

  _packsCache = packs;
  return packs;
}

// ─── getControlPromptTemplate ───

/**
 * 按 locale 获取 ControlPromptTemplate，未命中回退 en-US。
 * 加载结果内部缓存。
 */
export async function getControlPromptTemplate(locale: Locale): Promise<ControlPromptTemplate> {
  // 缓存命中
  const cached = _promptCache.get(locale);
  if (cached) return cached;

  try {
    const mod = await import(`./prompts-${locale}.ts`);
    const template = mod.default as ControlPromptTemplate;
    _promptCache.set(locale, template);
    return template;
  } catch {
    // 回退 en-US
    if (locale !== "en-US") {
      return getControlPromptTemplate("en-US");
    }
    // en-US 基底文件也加载失败——严重错误
    throw new Error(`Failed to load base prompt template for locale "${locale}"`);
  }
}

/** 清除所有缓存（用于测试） */
export function clearI18nCache(): void {
  _packsCache = null;
  _promptCache.clear();
}

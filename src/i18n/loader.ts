/**
 * I18N Language Pack loader
 *
 * Prompt templates are loaded via static imports + a mapping table, ensuring the bundler
 * (Bun.build) can correctly bundle them. To add a new language, simply add a static
 * import and a mapping entry in this file.
 */

import enUS from './prompts-en-US.js';
import zhCN from './prompts-zh-CN.js';
import type { LanguagePack, Locale, PromptsI18n } from './types.js';

// ─── Built-in language pack mapping ───

const PROMPT_MAP: Record<string, PromptsI18n> = {
  'en-US': enUS,
  'zh-CN': zhCN,
};

const LOCALE_LABELS: Record<string, string> = {
  'en-US': 'English',
  'zh-CN': '中文',
};

// ─── Global Locale singleton ───

let _currentLocale: Locale | null = null;

export function setCurrentLocale(locale: Locale): void {
  _currentLocale = locale;
}

export function getCurrentLocale(): Locale {
  return _currentLocale ?? 'en-US';
}

export function i18n(): PromptsI18n {
  return getControlPromptTemplate(getCurrentLocale());
}

// ─── Cache ───

let _packsCache: LanguagePack[] | null = null;

// ─── discoverLanguagePacks ───

/**
 * Returns the built-in language pack list, derived from PROMPT_MAP.
 * Results are cached internally; repeated calls return the same reference.
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
 * Returns a ControlPromptTemplate by locale, falling back to en-US on miss.
 * Looked up via the static mapping table — no dynamic import needed.
 */
export function getControlPromptTemplate(locale: Locale): PromptsI18n {
  const template = PROMPT_MAP[locale] ?? PROMPT_MAP['en-US'];
  if (!template) {
    throw new Error(`Failed to load base prompt template for locale "${locale}"`);
  }
  return template;
}

/** Clear all caches (for testing) */
export function clearI18nCache(): void {
  _packsCache = null;
  _currentLocale = null;
}

/**
 * I18N 模块入口
 */

export type { Locale, LanguagePack, ControlPromptTemplate } from "./types.js";
export { discoverLanguagePacks, getControlPromptTemplate, clearI18nCache } from "./loader.js";

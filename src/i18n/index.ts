export type {
  Locale,
  LanguagePack,
  PromptsI18n,
  ControlPromptTemplate,
  CodingStyleI18n,
  ErrorI18n,
} from './types.js';
export {
  discoverLanguagePacks,
  getControlPromptTemplate,
  setCurrentLocale,
  getCurrentLocale,
  i18n,
  clearI18nCache,
} from './loader.js';

/**
 * I18N 类型定义
 */

/** 语言标识，如 "en-US"、"zh-CN" */
export type Locale = string;

/** 语言包元数据（用于语言发现和展示） */
export interface LanguagePack {
  locale: Locale;
  label: string;
}

/** 流程控制提示词模板 — 文本 + 检测逻辑均在此抽象 */
export interface ControlPromptTemplate {
  locale: Locale;
  buildControlPrompt: (flowName?: string) => string;
  buildFlowWarningPrompt: () => string;
  isControlPromptPart: (text: string) => boolean;
  isWarningPromptPart: (text: string) => boolean;
}

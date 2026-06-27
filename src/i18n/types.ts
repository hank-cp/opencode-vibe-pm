/**
 * I18N 类型定义
 */

/** 语言标识，如 "en-US"、"zh-CN" */
export type Locale = string;

/** 语言包元数据（用于语言发现和展示） */
export interface LanguagePack {
  locale: Locale;
  /** 人类可读标签，如 "English" / "中文" */
  label: string;
}

/** 流程控制提示词模板 */
export interface ControlPromptTemplate {
  locale: Locale;
  /** 生成 <protect> 流程执行规则提示词 */
  buildControlPrompt: (flowName?: string) => string;
  /** 生成流程违规警告提示词 */
  buildFlowWarningPrompt: () => string;
}

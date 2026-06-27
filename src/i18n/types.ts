export type Locale = string;

export interface LanguagePack {
  locale: Locale;
  label: string;
}

export interface PromptsI18n {
  locale: Locale;
  buildControlPrompt: (flowName?: string) => string;
  buildFlowWarningPrompt: () => string;
  isControlPromptPart: (text: string) => boolean;
  isWarningPromptPart: (text: string) => boolean;
  tool: {
    unknownError: string;
    noSessionId: string;
    installSuccess: (id: string) => string;
    installFailure: (msg: string) => string;
    installStartHint: string;
    translateDictNote: string;
    [key: string]: unknown;
  };
  buildInitInstructions: (packs: LanguagePack[]) => string;
}

export interface ControlPromptTemplate {
  locale: Locale;
  buildControlPrompt: (flowName?: string) => string;
  buildFlowWarningPrompt: () => string;
  isControlPromptPart: (text: string) => boolean;
  isWarningPromptPart: (text: string) => boolean;
}

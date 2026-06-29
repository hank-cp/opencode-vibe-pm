export type Locale = string;

export interface LanguagePack {
  locale: Locale;
  label: string;
}

export interface CodingStyleI18n {
  generateIndex: (languagesStr: string, tableRows: string) => string;
}

export interface ErrorI18n {
  duplicateActiveTask: (
    flow: string,
    step: string,
    stepName: string,
    summary: string,
    startAt: string
  ) => string;
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
    noSessionIdShort: string;
    setStepNoTask: string;
    unknownSubCommand: (sub: string) => string;
    editNeedKey: string;
    editNeedValue: string;
    configUpdated: (key: string, value: string) => string;
    operationFailed: (msg: string) => string;
    installSuccess: (id: string) => string;
    installFailure: (msg: string) => string;
    installStartHint: string;
    codingStyleInstalled: (files: string[], regDir: string) => string;
    noTemplatesFound: string;
    templateList: (lines: string) => string;
    uninstallSuccess: (name: string) => string;
    uninstallFailure: (msg: string) => string;
    flowStartNoSession: string;
    commandDesc: Record<string, string>;
    [key: string]: unknown;
  };
  codingStyle: CodingStyleI18n;
  error: ErrorI18n;
  buildInitInstructions: (packs: LanguagePack[]) => string;
  buildInitRemainingSteps: (packs: LanguagePack[]) => string;
}

export interface ControlPromptTemplate {
  locale: Locale;
  buildControlPrompt: (flowName?: string) => string;
  buildFlowWarningPrompt: () => string;
  isControlPromptPart: (text: string) => boolean;
  isWarningPromptPart: (text: string) => boolean;
}

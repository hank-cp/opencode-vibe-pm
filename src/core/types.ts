/**
 * Plugin Core 类型定义
 *
 * 所有类型零外部依赖，Plugin Core 使用最小化本地接口定义。
 * OpenCode 宿主环境通过 PluginHooks 类型约束接入。
 */

// ─── PluginConfig ───
export interface PluginConfig {
  language: "zh-CN" | "en-US";
  dataDir: string;
  autoAnalyze: boolean;
  contextInjection: {
    /** 每步骤最大注入 token 数，0 表示不限制 */
    maxStepTokens: number;
    pruneIrrelevant: boolean;
  };
}

// ─── PluginContext ───
export interface IPluginContext {
  readonly config: PluginConfig;
  readonly projectDir: string;
  readonly dataDir: string;
}

// ─── Logger ───
export interface ILogger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

// ─── OpenCode Plugin Types (minimal local definitions) ───

/** OpenCode 传递给 Plugin 的上下文 */
export interface OpenCodePluginContext {
  /** 项目根目录 */
  directory: string;
  /** 其他属性按需扩展 */
  [key: string]: unknown;
}

/** config hook 操作的 OpenCode 配置对象 */
export interface OpenCodeConfig {
  command?: Record<string, OpenCodeCommandDeclaration>;
  [key: string]: unknown;
}

/** 命令声明（config hook 注册） */
export interface OpenCodeCommandDeclaration {
  template: string;
  description: string;
  agent?: string;
}

/** tool hook 的 execute 上下文 */
export interface ToolExecuteContext {
  [key: string]: unknown;
}

/** tool hook 注册的单个工具 */
export interface OpenCodeTool {
  description: string;
  args?: unknown;
  execute(args: unknown, ctx: ToolExecuteContext): Promise<string>;
}

/** chat.message hook 输入 */
export interface ChatMessageInput {
  messages: unknown[];
  [key: string]: unknown;
}

/** chat.message hook 输出（可修改） */
export interface ChatMessageOutput {
  [key: string]: unknown;
}

/** system.transform hook 输入/输出 */
export interface SystemTransformInput {
  system: string;
  [key: string]: unknown;
}

export interface SystemTransformOutput {
  system: string;
  [key: string]: unknown;
}

/** messages.transform hook 输入/输出 */
export interface MessagesTransformInput {
  messages: unknown[];
  [key: string]: unknown;
}

export interface MessagesTransformOutput {
  messages: unknown[];
  [key: string]: unknown;
}

/** event hook 事件 */
export interface OpenCodeEvent {
  type: string;
  properties: Record<string, unknown>;
}

// ─── Plugin Hooks (OpenCode plugin surface) ───

export interface PluginHooks {
  config?: (opencodeConfig: OpenCodeConfig) => void;
  tool?: Record<string, OpenCodeTool>;
  "chat.message"?: (
    input: ChatMessageInput,
    output: ChatMessageOutput,
  ) => void;
  "experimental.chat.system.transform"?: (
    input: SystemTransformInput,
    output: SystemTransformOutput,
  ) => void;
  "experimental.chat.messages.transform"?: (
    input: MessagesTransformInput,
    output: MessagesTransformOutput,
  ) => void;
  event?: (input: { event: OpenCodeEvent }) => void;
}

// ─── Module System ───

export interface ModuleHooks extends PluginHooks {
  // 模块可以贡献任意钩子子集
}

export type ModuleInit = (ctx: IPluginContext) => ModuleHooks;

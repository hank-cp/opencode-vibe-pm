/**
 * Plugin Core 类型定义
 *
 * OpenCode 交互类型通过 @opencode-ai/plugin SDK 导入。
 * 项目自有领域类型在此定义。
 */

// ─── SDK Re-exports ───

export type {
  Plugin,
  PluginInput,
  Hooks,
  Config,
  ToolContext,
  ToolDefinition,
} from "@opencode-ai/plugin";
export { tool } from "@opencode-ai/plugin";

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
  debug?: {
    /** 在 system.transform 末尾输出完整请求上下文（默认 false） */
    logFullRequest?: boolean;
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
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

// ─── Module System ───

/** 模块可以贡献的钩子子集，类型来自 SDK */
import type { Hooks } from "@opencode-ai/plugin";

export interface ModuleHooks extends Partial<Hooks> {
  // 模块可以贡献任意钩子子集
}

export type ModuleInit = (ctx: IPluginContext) => ModuleHooks;

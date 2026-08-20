/**
 * Plugin Core Type Definitions
 *
 * OpenCode interaction types are imported via the @opencode-ai/plugin SDK.
 * Project-specific domain types are defined here.
 */

// ─── SDK Re-exports ───

/** Subset of hooks a module can contribute, types from SDK */
import type { ToolDefinition } from '@opencode-ai/plugin';
import type { OpencodeClient } from '@opencode-ai/sdk';

export type {
  Plugin,
  PluginInput,
  Hooks,
  Config,
  ToolContext,
  ToolDefinition,
} from '@opencode-ai/plugin';
export { tool } from '@opencode-ai/plugin';

// ─── PluginConfig ───

/** Phase 2/3 agent orchestration settings (all optional, defaults filled by config loader) */
export interface AgentsConfig {
  /** Review sub-session sync-wait timeout in milliseconds (default 600000 = 10 min) */
  reviewTimeoutMs?: number;
  /** Journaler input window: most recent N conversation messages (default 20) */
  journalMessageWindow?: number;
  /** Journal directory relative to the project root (default `.vibe-pm/journal`) */
  journalDir?: string;
  /** Override for the built-in review framework prompt (default: built-in framework) */
  reviewFramework?: string;
}

export interface PluginConfig {
  language: string;
  dataDir: string;
  autoAnalyze: boolean;
  /** List of project programming languages analyzed by LLM, cached after first analysis. Prioritized during flow installation. */
  programmingLanguages?: string[];
  contextInjection: {
    /** Max context injection tokens per step, 0 means no limit */
    maxStepTokens: number;
    pruneIrrelevant: boolean;
  };
  agents?: AgentsConfig;
  debug?: {
    /** Output full request context at end of system.transform (default false) */
    logFullRequest?: boolean;
  };
}

// ─── PluginContext ───

export interface IPluginContext {
  readonly config: PluginConfig;
  readonly projectDir: string;
  readonly dataDir: string;
  readonly client: OpencodeClient;
}

// ─── Logger ───

export interface ILogger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export type ToolDefinitionWithKey = ToolDefinition & { toolKey: string };

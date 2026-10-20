/**
 * Plugin Core Type Definitions
 *
 * OpenCode V2 interaction types come from `@opencode/plugin` (entrypoint/context/domains)
 * and `@opencode/client` (server API shapes). Project-specific domain types live here.
 *
 * Design note: consumers depend on narrow structural interfaces declared here (Constitution V —
 * interfaces are defined at the consumer side), not on the full OpenCode client. The plugin
 * entrypoint wires the real `ctx` domains into these narrow shapes.
 */

// ─── SDK Re-exports ───

export type { Context as PluginContext, Cleanup } from '@opencode/plugin/promise/plugin';
export type {
  ToolContext,
  ToolEditor,
  Info as ToolInfo,
  Result as ToolResult,
} from '@opencode/plugin/promise/tool';
export type { CommandEditor, CommandInvocation } from '@opencode/plugin/promise/command';
import type { SessionMessageInfo } from '@opencode/client';
export type { SessionMessageInfo };

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
    /** Output full request context at the `context` hook (default false) */
    logFullRequest?: boolean;
  };
}

// ─── PluginContext ───

/**
 * The slice of the V2 session domain that command/tool implementations actually use.
 *
 * V2's plugin `SessionDomain` deliberately omits `message.get`, so message lookup goes through
 * `context({ sessionID })` and an ID match — one call covers both the "message that triggered
 * this tool" and "latest user message" cases.
 */
export interface SessionGateway {
  /** Full ordered transcript for a session, oldest first. */
  context(input: { sessionID: string }): Promise<readonly SessionMessageInfo[]>;
}

export interface IPluginContext {
  readonly config: PluginConfig;
  readonly projectDir: string;
  readonly dataDir: string;
  readonly session: SessionGateway;
}

// ─── Logger ───

export interface ILogger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

// ─── Message Model ───

/**
 * The V2 outbound request message model (`@opencode/ai`).
 *
 * V1 exposed `{ info, parts }`; V2 flattens to `{ role, content }`. Content parts are tagged by
 * `type`: `text | media | tool-call | tool-result | reasoning | compaction | effort`.
 */
export type AIMessage = import('@opencode/ai').Message;
export type AIContentPart = import('@opencode/ai').ContentPart;
export type AISystemPart = import('@opencode/ai').SystemPart;

/** Extracts plain text from V2 content parts (text parts only, in order). */
export function extractTextContent(parts: readonly AIContentPart[]): string {
  return parts
    .filter((p): p is Extract<AIContentPart, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('\n')
    .trim();
}
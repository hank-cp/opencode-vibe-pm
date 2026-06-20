import * as path from "node:path";
import { loadConfig, ensureDefaultConfig } from "./config.js";
import { registerCommands, registerTools } from "./commands.js";
import { logger, initLogger } from "./logger.js";
import { MemorySystem } from "../memory/index.js";
import { FlowEngine } from "../engine/index.js";
import { TokenCounter } from "../token/index.js";
import type { PartInfo } from "../token/types.js";
import type { Plugin, PluginInput, Hooks, IPluginContext, Config } from "./types.js";

export const VibePMPlugin: Plugin = async (ctx: PluginInput): Promise<Hooks> => {
  ensureDefaultConfig(ctx.directory);
  const config = loadConfig(ctx.directory);
  const dataDir = path.resolve(ctx.directory, config.dataDir);
  const pluginCtx: IPluginContext = { config, projectDir: ctx.directory, dataDir };
  initLogger(ctx.client);
  logger.info(`vibe-pm initializing in ${ctx.directory}`);

  const memory = new MemorySystem();
  await memory.init(dataDir);

  const engine = new FlowEngine(memory, ctx.directory);

  let tokenCounter: TokenCounter | null = null;
  try {
    tokenCounter = new TokenCounter("cl100k_base");
  } catch (err) {
    logger.warn(
      `TokenCounter initialization failed, token counting disabled: ${err}`,
    );
  }

  /**
   * 将 OpenCode Part[] 转换为 PartInfo[]，补充 role 信息。
   */
  function toPartInfos(
    parts: { type: string; text?: string; [key: string]: unknown }[],
    role?: string,
  ): PartInfo[] {
    return parts.map((p) => ({
      type: p.type,
      text: p.text,
      args: p.args,
      state: p.state as PartInfo["state"],
      role: (typeof p.role === "string" ? p.role : undefined)
        ?? (p.type === "tool" ? "tool" : undefined)
        ?? (p.type === "reasoning" ? "assistant" : undefined)
        ?? role,
      isControlPrompt: p.type === "text" && p.text?.includes("<protect>"),
    }));
  }

  return {
    config: async (c: Config) => { registerCommands(c); },
    tool: registerTools(pluginCtx, engine),

    "experimental.chat.messages.transform": async (_input, output) => {
      const originalPartsCache = new Map<string, PartInfo[]>();
      const flowSessions = new Set<string>();

      for (const msg of output.messages) {
        const info = msg.info as { role?: string; id?: string; sessionID?: string };
        if (info.role !== "user" || !info.sessionID) continue;
        const parts = msg.parts as { type: string; text: string }[];
        const flow = engine.detectFlowCmd(parts.filter((p) => p.type === "text").map((p) => p.text).join("\n"));
        if (flow) {
          flowSessions.add(info.sessionID);
          originalPartsCache.set(info.sessionID, toPartInfos(parts, info.role));
          await engine.ensureTaskAndInject(info.sessionID, flow, parts, info.id ?? "", info.sessionID);
        }
      }

      if (tokenCounter) {
        for (const msg of output.messages) {
          const info = msg.info as { role?: string; id?: string; sessionID?: string };
          if (!info.sessionID) continue;
          const parts = msg.parts as { type: string; text?: string; [key: string]: unknown }[];
          try {
            const task = await memory.getActiveTask(info.sessionID);
            if (!task) continue;
            const partInfos = toPartInfos(parts, info.role);
            const originalPartInfos = originalPartsCache.get(info.sessionID);
            const result = originalPartInfos
              ? tokenCounter.countPromptTokens(partInfos, originalPartInfos)
              : tokenCounter.countCompletionTokens(partInfos);
            await memory.recordStepEntry(info.sessionID, task.flow, task.currentStep, task.currentStepName, result.bySource);
            logger.debug(
              `[vibe-pm] transform: role=${info.role} step=${task.currentStep} sources=${JSON.stringify(result.bySource)}`,
            );
          } catch { /* best-effort */ }
        }
      }

      for (const msg of output.messages) {
        const info = msg.info as { role?: string; id?: string; sessionID?: string };
        if (!flowSessions.has(info.sessionID ?? "")) {
          engine.removeControlPrompt(msg.parts as { type: string; text: string }[]);
        }
      }
    },

    event: async ({ event }) => {
      if (event.type === "session.created") engine.clearCommandFlowCache();
    },
  };
};

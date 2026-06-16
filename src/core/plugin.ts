/**
 * Plugin Core - VibePMPlugin
 *
 * LLM 自行管理步骤流转。插件只注入 control prompt 和提供工具。
 */

import * as path from "node:path";
import { loadConfig, ensureDefaultConfig } from "./config.js";
import { registerCommands, registerTools } from "./commands.js";
import { logger } from "./logger.js";
import { MemorySystem } from "../memory/index.js";
import { FlowEngine } from "../engine/index.js";
import type { Plugin, PluginInput, Hooks, IPluginContext, Config } from "./types.js";

const PM_COMMAND_PREFIX = "pm-";

export const VibePMPlugin: Plugin = async (ctx: PluginInput): Promise<Hooks> => {
  ensureDefaultConfig(ctx.directory);

  const config = loadConfig(ctx.directory);
  const dataDir = path.resolve(ctx.directory, config.dataDir);
  const pluginCtx: IPluginContext = { config, projectDir: ctx.directory, dataDir };

  logger.info(`vibe-pm initializing in ${ctx.directory}`);

  const memory = new MemorySystem();
  await memory.init(dataDir);
  const engine = new FlowEngine(memory, ctx.directory);

  return {
    config: async (opencodeConfig: Config) => { registerCommands(opencodeConfig); },

    tool: registerTools(pluginCtx, engine),

    "command.execute.before": async (input, output) => {
      const cmd = input as { command?: string; sessionID?: string; arguments?: string };
      const cmdName = cmd.command ?? "";

      if (cmdName.startsWith(PM_COMMAND_PREFIX)) {
        const flowName = engine.resolveFlowFromCommand(cmdName);
        if (flowName) {
          const prompt = engine.buildControlPrompt(flowName);
          (output as { parts: unknown[] }).parts.push({ type: "text", text: prompt });
        }
      }
    },

    event: async ({ event }) => {
      if (event.type === "session.created") engine.clearCommandFlowCache();
    },
  };
};

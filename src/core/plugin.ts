import * as path from "node:path";
import { loadConfig, ensureDefaultConfig } from "./config.js";
import { registerCommands, registerTools } from "./commands.js";
import { logger, initLogger } from "./logger.js";
import { MemorySystem } from "../memory/index.js";
import { FlowEngine } from "../engine/index.js";
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

  return {
    config: async (c: Config) => { registerCommands(c); },
    tool: registerTools(pluginCtx, engine),

    "experimental.chat.messages.transform": async (_input, output) => {
      for (const msg of output.messages) {
        const info = msg.info as { role?: string; id?: string; sessionID?: string };
        if (info.role !== "user") continue;
        const parts = msg.parts as { type: string; text: string }[];
        const flow = engine.detectFlowCmd(parts.filter((p) => p.type === "text").map((p) => p.text).join("\n"));
        if (flow && info.sessionID) {
          await engine.ensureTaskAndInject(info.sessionID, flow, parts, info.id ?? "", info.sessionID);
          return;
        }
      }
      for (const msg of output.messages) {
        engine.removeControlPrompt(msg.parts as { type: string; text: string }[]);
      }
    },

    event: async ({ event }) => {
      if (event.type === "session.created") engine.clearCommandFlowCache();
    },
  };
};

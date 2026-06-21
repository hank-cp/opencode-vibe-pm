import * as path from "node:path";
import {ensureDefaultConfig, loadConfig} from "./config.js";
import {registerCommands, registerTools} from "./commands.js";
import {initLogger, logger} from "./logger.js";
import {MemorySystem} from "../memory";
import {FlowEngine} from "../engine";
import type {ApiTelemetry, TokenCount} from "../token";
import {TokenCounter} from "../token";
import type {Config, Hooks, IPluginContext, Plugin, PluginInput} from "./types.js";
import type {AssistantMessage} from "@opencode-ai/sdk";

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

  return {
    config: async (c: Config) => { registerCommands(c); },
    tool: registerTools(pluginCtx, engine, memory),

    "experimental.chat.messages.transform": async (_input, output) => {
      const flowSessions = new Set<string>();

      for (const msg of output.messages) {
        const info = msg.info
        if (info.role !== "user" || !info.sessionID) continue;
        const parts = msg.parts;
        const flow = engine.detectFlowCmd(parts.filter((p) => p.type === "text").map((p) => p.text).join("\n"));
        if (flow) {
          flowSessions.add(info.sessionID);
          await engine.ensureTaskAndInject(info.sessionID, flow, parts, info.id ?? "", info.sessionID);
        }
      }

      if (tokenCounter) {
        let apiTelemetry: ApiTelemetry | undefined = undefined;
        let sessionId: string | undefined;
        const total: TokenCount = { text: 0, user: 0, assistant: 0, flowControl: 0, tool: 0, reasoning: 0 }
        for (const msg of output.messages) {
          const info = msg.info;
          if (!info.sessionID) continue;
          sessionId = info.sessionID
          apiTelemetry = (info as AssistantMessage).tokens;

          // Count tokens unconditionally
          const result = tokenCounter.countContextTokens(msg);
          total.text += result.text;
          total.user += result.user;
          total.assistant += result.assistant;
          total.flowControl += result.flowControl;
          total.tool += result.tool;
          total.reasoning += result.reasoning;

          // Also write to flowMetrics if active task exists (per-step tracking)
          const task = await memory.getActiveTask(info.sessionID);
          if (task) {
            memory.recordStepEntry(info.sessionID, task.flow, task.currentStep, task.currentStepName, result).catch(e => {
              logger.error(`[vibe-pm] recordStepEntry failed: ${e}`)
            });
          }

          logger.debug(
            `[vibe-pm] transform: sid=${info.sessionID} role=${info.role} step=${task?.currentStep ?? 'N/A'}`,
          );
        }

        if (sessionId) {
          memory.recordSessionTokens(sessionId, total, apiTelemetry).catch(e => {
            logger.error(`[vibe-pm] recordSessionTokens failed: ${e}`);
          });
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
      if (event.type === "session.created") {
        engine.clearCommandFlowCache();
        const sessionId = (event as { sessionID?: string }).sessionID;
        if (sessionId) {
          try {
            await memory.initSessionTokens(sessionId);
            logger.info(`[vibe-pm] session_tokens initialized for ${sessionId}`);
          } catch (err) {
            logger.warn(`[vibe-pm] session_tokens init failed: ${err}`);
          }
        }
      }
    },
  };
};

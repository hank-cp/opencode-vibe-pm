import * as path from "node:path";
import {ensureDefaultConfig, loadConfig} from "./config.js";
import {registerCommands, registerFlowCommands, registerFlowTools, registerTools} from "./commands.js";
import {initLogger, logger} from "./logger.js";
import {MemorySystem} from "../memory";
import {FlowEngine} from "../engine";
import type {ApiTelemetry, ModelInfo, TokenCount} from "../token";
import {TokenCounter} from "../token";
import type {Config, Hooks, IPluginContext, Plugin, PluginInput} from "./types.js";
import type {UserMessage, AssistantMessage} from "@opencode-ai/sdk";

export const VibePMPlugin: Plugin = async (ctx: PluginInput): Promise<Hooks> => {
  ensureDefaultConfig(ctx.directory);
  const config = loadConfig(ctx.directory);
  const dataDir = path.resolve(ctx.directory, config.dataDir);
  const pluginCtx: IPluginContext = { config, projectDir: ctx.directory, dataDir, client: ctx.client };
  initLogger(ctx.client);
  logger.info(`vibe-pm initializing in ${ctx.directory}`);

  const memory = new MemorySystem();
  await memory.init(dataDir);

  const engine = new FlowEngine(memory, ctx.directory);


  return {
    config: async (c: Config) => {
      registerCommands(c);
      registerFlowCommands(c, ctx.directory);
    },
    tool: (() => {
      const tools = Object.assign(registerTools(pluginCtx, engine, memory),
                           registerFlowTools(pluginCtx, engine));
      logger.info(`registering tools: ${Object.keys(tools)}`);
      return tools;
    })(),

    "experimental.chat.messages.transform": async (_input, output) => {
      const msg0 = output.messages[0];
      const userMsgInfo0 = output.messages.map(m => m.info).find(info => 'model' in info) as UserMessage;
      const info0 = msg0?.info;
      const sid = info0?.sessionID;
      const sessionResult = await ctx.client.session.get({
        path: { id: sid },
      });
      const session = sessionResult.data;
      if (!session || !sid) return;

      const modelInfo: ModelInfo = {
        providerID: userMsgInfo0?.model?.providerID ?? "",
        modelID: userMsgInfo0?.model?.modelID ?? "",
      };
      let tokenCounter: TokenCounter | null = null;
      try {
        tokenCounter = new TokenCounter(modelInfo);
      } catch (err) {
        logger.warn(`TokenCounter init failed: ${err}`);
      }

      // TODO debug code, need continuous observation
      const flowSessions = new Set<string>();
      for (const msg of output.messages) {
        flowSessions.add(msg.info.sessionID ?? "");
      }
      logger.info(`messages.transform hook entered: sid=${sid}, parentSid=${session?.parentID}, modelId=${modelInfo.modelID}, providerId=${modelInfo.providerID}`);
      logger.info(`sessionIds in flow: ${flowSessions.size}`);

      const task = await memory.getActiveTask(sid);

      // ═══ LOOP: accumulate token counts + detect outOfControl ═══
      const totalTokens: TokenCount = { text: 0, user: 0, assistant: 0, flowControl: 0, tool: 0, reasoning: 0 };
      const stepTokens: TokenCount = { text: 0, user: 0, assistant: 0, flowControl: 0, tool: 0, reasoning: 0 };
      let outOfControl = false;
      let apiTelemetry: ApiTelemetry | undefined;

      if (tokenCounter) {
        for (const msg of output.messages) {
          const info = msg.info;
          if (!info.sessionID) continue;

          const result = tokenCounter.countContextTokens(msg);
          totalTokens.text += result.text;
          totalTokens.user += result.user;
          totalTokens.assistant += result.assistant;
          totalTokens.flowControl += result.flowControl;
          totalTokens.tool += result.tool;
          totalTokens.reasoning += result.reasoning;

          if (task) {
            stepTokens.text += result.text;
            stepTokens.user += result.user;
            stepTokens.assistant += result.assistant;
            stepTokens.flowControl += result.flowControl;
            stepTokens.tool += result.tool;
            stepTokens.reasoning += result.reasoning;
          }

          if (info.role === "assistant") {
            apiTelemetry = (info as AssistantMessage).tokens;

            if (task && !outOfControl) {
              const stepCalled = (task.stepTransitions?.length ?? 0) > 0;
              const hasTodo = msg.parts.some(
                (p) => p.type === "tool" && (p as { name?: string }).name === "todowrite",
              );
              if (hasTodo && !stepCalled) {
                outOfControl = true;
                logger.info(`transform: outOfControl detected sid=${sid}`);
              }
            }
          }
        }

        if (session.parentID) {
          memory.recordSubagentTokens(sid, session.parentID, totalTokens, apiTelemetry).catch((e: unknown) => {
            logger.error(`recordSubagentTokens failed: ${e}`);
          });
        } else {
          memory.recordSessionTokens(sid, totalTokens, apiTelemetry).catch((e: unknown) => {
            logger.error(`recordSessionTokens failed: ${e}`);
          });

          if (task) {
            memory.recordStepTokens(sid, task.flow, task.currentStep, task.currentStepName, stepTokens).catch((e: unknown) => {
              logger.error(`recordStepTokens failed: ${e}`);
            });
          }
        }
      }

      // ═══ INJECT: flow control + warning (on first user message) ═══
      if (task) {
        const userMsg = output.messages.find((m) => (m.info as { role?: string }).role === "user");
        if (userMsg) {
          const umInfo = userMsg.info as { id?: string; sessionID?: string };
          engine.injectFlowControlPrompt(sid, task.flow, userMsg.parts, umInfo.id ?? "", umInfo.sessionID ?? "");
          if (outOfControl) {
            engine.injectFlowWarningPrompt(sid, userMsg.parts, umInfo.id ?? "", umInfo.sessionID ?? "");
          }
        }
      }

      // ═══ CLEANUP: remove stale synthetic parts (only when no active task) ═══
      if (!task) {
        for (const msg of output.messages) {
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
            logger.info(`session_tokens initialized for ${sessionId}`);
          } catch (err) {
            logger.warn(`session_tokens init failed: ${err}`);
          }
        }
      }
    },
  };
};

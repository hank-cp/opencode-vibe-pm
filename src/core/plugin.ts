/**
 * vibe-pm Plugin Entry (OpenCode V2)
 *
 * V2 plugins are declared with `Plugin.define({ id, setup })` and receive a domain-based
 * context (`ctx.session` / `ctx.tool` / `ctx.command` / `ctx.event` …) instead of the V1
 * SDK client. Everything is registered from `setup`, which may return a cleanup.
 *
 * Registration order mirrors the V1 behaviour: config → logger → memory → engine →
 * locale → commands → tools → context hook → event subscription.
 */

import * as path from 'node:path';
import { Plugin } from '@opencode/plugin';
import { ensureDefaultConfig, loadConfig } from './config.js';
import {
  registerCommands,
  registerFlowCommands,
  registerFlowTools,
  registerTools,
} from './commands.js';
import { initLogger, logger } from './logger.js';
import { MemorySystem } from '../memory';
import { createSubsessionClient, FlowEngine } from '../engine';
import type { ApiTelemetry, ModelInfo, TokenCount } from '../token';
import type { AIContentPart, AIMessage, IPluginContext, SessionMessageInfo } from './types.js';
import { discoverLanguagePacks, setCurrentLocale } from '../i18n';
import { TokenCounter } from '../token/token-counter';

/** Latest assistant usage in a transcript (V2 `Message` carries no usage; the transcript does). */
function findLatestAssistantTokens(
  messages: readonly SessionMessageInfo[],
): ApiTelemetry | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.type === 'assistant' && message.tokens) return message.tokens;
  }
  return undefined;
}

function emptyTokenCount(): TokenCount {
  return { text: 0, user: 0, assistant: 0, flowControl: 0, tool: 0, reasoning: 0 };
}

/**
 * Whether the request carries the todo tool.
 *
 * Built-in tool names are runtime-defined rather than schema-typed, and the spelling has
 * drifted between releases (`todowrite` / `todo_write`), so match case- and separator-
 * insensitively instead of hardcoding one literal.
 */
function hasTodoTool(tools: Record<string, unknown>): boolean {
  return Object.keys(tools).some((name) => name.toLowerCase().replace(/_/g, '') === 'todowrite');
}

/**
 * V2 types `Message.content` as a readonly array, but the agent-loop hook is documented to
 * mutate it (synthetic parts are injected/removed in place). The runtime array is mutable,
 * so expose it under its editable type instead of rebuilding the message.
 */
function editableContent(message: AIMessage): AIContentPart[] {
  return message.content as AIContentPart[];
}

export const VibePMPlugin = Plugin.define({
  id: 'vibe-pm',
  async setup(ctx) {
    const projectDir = ctx.location.directory;
    ensureDefaultConfig(projectDir);
    const config = loadConfig(projectDir);
    const dataDir = path.resolve(projectDir, config.dataDir);
    initLogger({ dataDir });
    logger.info(`vibe-pm initializing in ${projectDir}`);

    const memory = new MemorySystem();
    await memory.init(dataDir);

    const engine = new FlowEngine(memory, projectDir, {
      subsessionClient: createSubsessionClient(ctx.session),
      agents: config.agents,
    });

    const pluginCtx: IPluginContext = {
      config,
      projectDir,
      dataDir,
      session: ctx.session,
    };

    // ─── i18n locale resolution ───
    const packs = discoverLanguagePacks();
    const validLocales = new Set(packs.map((p) => p.locale));
    const locale = validLocales.has(config.language) ? config.language : 'en-US';
    if (!validLocales.has(config.language)) {
      logger.warn(
        `config.language "${config.language}" not found in available packs, fallback to "en-US"`,
      );
    }
    setCurrentLocale(locale);
    engine.initLocale(locale);

    // ─── Commands ───
    await ctx.command.transform((editor) => {
      registerCommands(editor, ctx.session);
    });
    await ctx.command.transform((editor) => {
      registerFlowCommands(editor, projectDir, ctx.session);
    });

    // ─── Tools ───
    await ctx.tool.transform((editor) => {
      registerTools(editor, pluginCtx, engine, memory);
    });
    await ctx.tool.transform((editor) => {
      registerFlowTools(editor, pluginCtx, engine);
    });

    // ─── Context hook: token metering + flow prompt injection ───
    await ctx.session.hook('context', async (event) => {
      const sid: string = event.sessionID;

      let parentID: string | undefined;
      try {
        const session = await ctx.session.get({ sessionID: sid });
        parentID = session.parentID;
      } catch (err) {
        logger.warn(`context hook: session.get failed sid=${sid}: ${err}`);
        return;
      }

      const modelInfo: ModelInfo = {
        providerID: event.model.providerID,
        modelID: event.model.id,
      };
      let tokenCounter: TokenCounter | null = null;
      try {
        tokenCounter = new TokenCounter(modelInfo);
      } catch (err) {
        logger.warn(`TokenCounter init failed: ${err}`);
      }

      const messages: AIMessage[] = event.messages;
      logger.info(
        `context hook entered: sid=${sid}, parentSid=${parentID}, modelId=${modelInfo.modelID}, providerId=${modelInfo.providerID}`,
      );

      const task = await memory.getActiveTask(sid);

      // ═══ LOOP: accumulate token counts + detect outOfControl ═══
      const totalTokens = emptyTokenCount();
      const stepTokens = emptyTokenCount();
      let outOfControl = false;

      if (tokenCounter) {
        // V2 `Message` carries no usage; the persisted transcript does. Start the fetch
        // before the (synchronous) counting loop so the round-trip overlaps with it, and
        // skip it entirely on a first-turn request that has produced no assistant message.
        const transcriptPromise = messages.some((m) => m.role === 'assistant')
          ? ctx.session.context({ sessionID: sid }).catch((err: unknown) => {
            logger.warn(`context hook: session context fetch failed sid=${sid}: ${err}`);
            return [] as SessionMessageInfo[];
          })
          : undefined;

        for (const msg of messages) {
          const result = tokenCounter.countContextTokens({ message: msg });
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

          if (msg.role === 'assistant' && task && !outOfControl) {
            const stepCalled = (task.stepTransitions?.length ?? 0) > 0;
            if (hasTodoTool(event.tools) && !stepCalled) {
              outOfControl = true;
              logger.info(`context hook: outOfControl detected sid=${sid}`);
            }
          }
        }

        const apiTelemetry = transcriptPromise
          ? findLatestAssistantTokens(await transcriptPromise)
          : undefined;

        if (parentID) {
          memory
            .recordSubagentTokens(sid, parentID, totalTokens, apiTelemetry)
            .catch((e: unknown) => {
              logger.error(`recordSubagentTokens failed: ${e}`);
            });
        } else {
          memory.recordSessionTokens(sid, totalTokens, apiTelemetry).catch((e: unknown) => {
            logger.error(`recordSessionTokens failed: ${e}`);
          });

          if (task) {
            memory
              .recordStepTokens(sid, task.flow, task.currentStep, task.currentStepName, stepTokens)
              .catch((e: unknown) => {
                logger.error(`recordStepTokens failed: ${e}`);
              });
          }
        }
      }

      // ═══ INJECT: flow control + warning (on first user message) ═══
      if (task) {
        const userMsg = messages.find((m) => m.role === 'user');
        if (userMsg) {
          await engine.injectFlowControlPrompt(task.flow, editableContent(userMsg));
          if (outOfControl) {
            engine.injectFlowWarningPrompt(editableContent(userMsg));
          }
        }
      }

      // ═══ CLEANUP: remove stale synthetic parts (only when no active task) ═══
      if (!task) {
        for (const msg of messages) {
          engine.removeControlPrompt(editableContent(msg));
        }
      }
    });

    // ─── Event subscription: per-session token bookkeeping ───
    const controller = new AbortController();
    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
          if (event.type !== 'session.created') continue;

          engine.clearCommandFlowCache();
          const sessionId: string = event.data.sessionID;
          try {
            await memory.initSessionTokens(sessionId);
            logger.info(`session_tokens initialized for ${sessionId}`);
          } catch (err) {
            logger.warn(`session_tokens init failed: ${err}`);
          }
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          logger.warn(`event subscription ended: ${err}`);
        }
      }
    })();

    return () => controller.abort();
  },
});

export default VibePMPlugin;

import * as path from "node:path";
import { loadConfig, ensureDefaultConfig } from "./config.js";
import { registerCommands, registerTools } from "./commands.js";
import { logger, initLogger } from "./logger.js";
import { MemorySystem } from "../memory/index.js";
import { FlowEngine } from "../engine/index.js";
import { TokenCounter } from "../token/index.js";
import { writeTuiData, initTuiBridge } from "../shared/tui-bridge.js";
import type { PartInfo } from "../token/types.js";
import type { Plugin, PluginInput, Hooks, IPluginContext, Config } from "./types.js";

async function flushTuiBridge(memory: MemorySystem, sessionId: string): Promise<void> {
  try {
    const active = await memory.getActiveTask(sessionId);
    const last = active ? null : await memory.getLastClosedTask(sessionId);
    const sourceBreakdown = await memory.getSourceTokenBreakdown(sessionId);
    const stepBreakdown = await memory.getStepTokenBreakdown(sessionId);
    const totalTokens = sourceBreakdown.reduce((s, e) => s + e.tokens, 0);

    if (active) {
      writeTuiData({
        taskStatus: {
          type: "active", flow: active.flow,
          currentStep: active.currentStep, currentStepName: active.currentStepName,
          startAt: active.startAt, specRef: active.specRef, planRef: active.planRef,
        },
        tokenData: { totalTokens, sourceBreakdown, stepBreakdown },
      });
    } else if (last) {
      writeTuiData({
        taskStatus: { type: "last", flow: last.flow, startAt: last.startAt, endAt: last.endAt },
        tokenData: { totalTokens, sourceBreakdown, stepBreakdown },
      });
    } else {
      writeTuiData({
        taskStatus: { type: "empty" },
        tokenData: { totalTokens: 0, sourceBreakdown: [], stepBreakdown: [] },
      });
    }
  } catch {
    // 桥接写入是尽力而为的
  }
}

export const VibePMPlugin: Plugin = async (ctx: PluginInput): Promise<Hooks> => {
  ensureDefaultConfig(ctx.directory);
  const config = loadConfig(ctx.directory);
  const dataDir = path.resolve(ctx.directory, config.dataDir);
  const pluginCtx: IPluginContext = { config, projectDir: ctx.directory, dataDir };
  initLogger(ctx.client);
  logger.info(`vibe-pm initializing in ${ctx.directory}`);

  const memory = new MemorySystem();
  await memory.init(dataDir);
  initTuiBridge(dataDir);

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
      const touchedSessions = new Set<string>();

      for (const msg of output.messages) {
        const info = msg.info as { role?: string; id?: string; sessionID?: string };
        if (info.sessionID) touchedSessions.add(info.sessionID);
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

      // 为所有受影响的 session 写入桥接数据（fire-and-forget，不阻塞消息处理）
      for (const sid of touchedSessions) {
        void flushTuiBridge(memory, sid);
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

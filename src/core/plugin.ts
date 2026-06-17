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

  // TokenCounter 初始化失败时降级为 null（不阻塞插件启动）
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
      role: (typeof p.role === "string" ? p.role : undefined)
        ?? (p.type === "tool_use" || p.type === "tool" ? "tool" : undefined)
        ?? role,
      isControlPrompt: p.type === "text" && p.text?.includes("<protect>"),
    }));
  }

  /**
   * 尝试为当前活跃任务记录 prompt token 计数。
   * 计数失败不抛出异常，仅记录 debug 日志。
   */
  async function tryRecordPromptTokens(
    sessionId: string,
    parts: { type: string; text?: string }[],
    role: string,
    originalPartInfos?: PartInfo[],
  ): Promise<void> {
    if (!tokenCounter) return;
    try {
      const task = await memory.getActiveTask(sessionId);
      if (!task) {
        logger.debug(
          `[vibe-pm] tryRecordPromptTokens: no active task for session ${sessionId}, skip`,
        );
        return;
      }

      const partInfos = toPartInfos(parts, role);
      const result = tokenCounter.countPromptTokens(partInfos, originalPartInfos);

      await memory.recordStepEntry(
        sessionId,
        task.flow,
        task.currentStep,
        task.currentStepName,
        result.bySource,
      );
    } catch (err) {
      logger.debug(
        `[vibe-pm] tryRecordPromptTokens failed: ${err}`,
      );
    }
  }

  /**
   * 尝试为当前活跃任务记录 completion token 计数。
   */
  async function tryRecordCompletionTokens(
    sessionId: string,
    parts: { type: string; text?: string }[],
    role?: string,
  ): Promise<void> {
    if (!tokenCounter) return;
    try {
      const task = await memory.getActiveTask(sessionId);
      if (!task) {
        logger.debug(
          `[vibe-pm] tryRecordCompletionTokens: no active task for session ${sessionId}, skip`,
        );
        return;
      }

      const partInfos = toPartInfos(parts, role);
      const result = tokenCounter.countCompletionTokens(partInfos);

      logger.info(
        `[vibe-pm] completion: step=${task.currentStep} sources=${JSON.stringify(result.bySource)} partRoles=${JSON.stringify(partInfos.map(p => ({type:p.type, role:p.role})))}}`,
      );

      await memory.recordStepEntry(
        sessionId,
        task.flow,
        task.currentStep,
        task.currentStepName,
        result.bySource,
      );
    } catch (err) {
      logger.debug(
        `[vibe-pm] tryRecordCompletionTokens failed: ${err}`,
      );
    }
  }

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
          // 保存原始 parts 快照（用于 FlowControl 增量化拆分）
          const originalPartInfos = toPartInfos(parts, info.role);

          await engine.ensureTaskAndInject(info.sessionID, flow, parts, info.id ?? "", info.sessionID);

          // 计数并记录 prompt token
          await tryRecordPromptTokens(info.sessionID, parts, info.role, originalPartInfos);
          return;
        }
      }
      for (const msg of output.messages) {
        engine.removeControlPrompt(msg.parts as { type: string; text: string }[]);
      }
    },

    "chat.message": async (input, output) => {
      const sessionID = input.sessionID;
      if (!sessionID) return;

      const parts = output.parts as { type: string; text?: string }[];
      await tryRecordCompletionTokens(sessionID, parts, "assistant");
    },

    event: async ({ event }) => {
      if (event.type === "session.created") engine.clearCommandFlowCache();
    },
  };
};

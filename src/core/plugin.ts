/**
 * Plugin Core - VibePMPlugin
 *
 * 插件入口函数。负责：配置加载、模块初始化、钩子注册。
 * 模块（Memory System, Flow Engine 等）通过普通 import 接入。
 */

import * as path from "node:path";
import { loadConfig } from "./config.js";
import { registerCommands, registerTools } from "./commands.js";
import { logger } from "./logger.js";
import { MemorySystem } from "../memory/index.js";
import { FlowEngine } from "../engine/index.js";
import type {
  Plugin,
  PluginInput,
  Hooks,
  IPluginContext,
  Config,
} from "./types.js";

// ─── Plugin 导出 ───

/**
 * vibe-pm 插件主入口。
 */
export const VibePMPlugin: Plugin = async (
  ctx: PluginInput,
): Promise<Hooks> => {
  // 1. 加载配置
  const config = loadConfig(ctx.directory);
  const dataDir = path.resolve(ctx.directory, config.dataDir);

  const pluginCtx: IPluginContext = {
    config,
    projectDir: ctx.directory,
    dataDir,
  };

  logger.info(`vibe-pm initializing in ${ctx.directory}`);

  // 2. 初始化 Memory System
  const memory = new MemorySystem();
  await memory.init(dataDir);

  // 3. 初始化 Flow Engine
  const engine = new FlowEngine(memory, ctx.directory, config);

  // 4. 注册所有钩子
  logger.info("vibe-pm hooks registered");

  return {
    // 命令声明
    config: async (opencodeConfig: Config) =>
      registerCommands(opencodeConfig),

    // 可执行工具
    tool: registerTools(pluginCtx),

    // 消息到达 → 检查任务状态
    "chat.message": async (input, _output) =>
      engine.onMessage(input),

    // 系统提示注入
    "experimental.chat.system.transform": async (input, output) =>
      engine.injectContext(input, output),

    // 消息裁剪
    "experimental.chat.messages.transform": async (input, output) =>
      engine.transformMessages(input, output),

    // 生命周期事件
    event: async ({ event }) => {
      if (event.type === "session.created") {
        // Stub: 记录会话创建
      }
      if (event.type === "session.idle") {
        await engine.onSessionIdle(
          (event.properties?.sessionID as string) ?? "",
        );
      }
    },
  };
};

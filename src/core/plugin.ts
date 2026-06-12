/**
 * Plugin Core - VibePMPlugin
 *
 * 插件入口函数。负责：配置加载、模块初始化、钩子注册。
 * 模块（Memory System, Flow Engine 等）通过普通 import 接入。
 *
 * 当前阶段：Flow Engine 为 stub，返回空实现。
 */

import * as path from "node:path";
import { loadConfig } from "./config.js";
import { registerCommands, registerTools } from "./commands.js";
import { logger } from "./logger.js";
import { MemorySystem } from "../memory/index.js";
import type {
  PluginHooks,
  OpenCodePluginContext,
  IPluginContext,
} from "./types.js";

// ─── Stub 模块（后续由 Flow Engine 实现替换）───

class FlowEngine {
  constructor(
    private _memory: MemorySystem,
    private _projectDir: string,
  ) {};

  // Stub: 消息处理
  onMessage(_input: unknown, _output: unknown): void {
    // 无活跃任务时不干预
  }

  // Stub: 上下文注入
  injectContext(_input: unknown, _output: unknown): void {
    // 无活跃任务时不干预
  }

  // Stub: 消息裁剪
  transformMessages(_input: unknown, _output: unknown): void {
    // 无活跃任务时不干预
  }

  // Stub: 会话空闲处理
  onSessionIdle(_sessionId: string): void {
    // 无操作
  }
}

// ─── Plugin 导出 ───

/**
 * vibe-pm 插件主入口。
 *
 * @param ctx OpenCode 提供的 PluginContext
 * @returns PluginHooks 对象
 */
export async function VibePMPlugin(
  ctx: OpenCodePluginContext,
): Promise<PluginHooks> {
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

  // 3. 初始化 Flow Engine（当前为 stub）
  const engine = new FlowEngine(memory, ctx.directory);

  // 4. 注册所有钩子
  logger.info("vibe-pm hooks registered");

  return {
    // 命令声明
    config: (opencodeConfig) => registerCommands(opencodeConfig),

    // 可执行工具
    tool: registerTools(pluginCtx),

    // 消息到达 → 检查任务状态
    "chat.message": (input, output) => engine.onMessage(input, output),

    // 系统提示注入
    "experimental.chat.system.transform": (input, output) =>
      engine.injectContext(input, output),

    // 消息裁剪
    "experimental.chat.messages.transform": (input, output) =>
      engine.transformMessages(input, output),

    // 生命周期事件
    event: ({ event }) => {
      if (event.type === "session.created") {
        // Stub: 记录会话创建
      }
      if (event.type === "session.idle") {
        engine.onSessionIdle(event.properties?.sessionID as string);
      }
    },
  };
}

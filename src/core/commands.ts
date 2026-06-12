/**
 * 命令注册
 *
 * 通过 config hook（声明式）和 tool hook（可执行）注册全部 8 个 /pm-* 命令。
 * 使用 @opencode-ai/plugin SDK 的 tool() 工厂函数。
 * 当前阶段：可执行命令为 stub 实现，返回占位提示。
 */

import { tool } from "@opencode-ai/plugin";
import type {
  ToolContext,
  ToolDefinition,
  IPluginContext,
  Config,
} from "./types.js";

// ─── 命令清单 ───

interface CommandMeta {
  name: string;
  description: string;
  template: string;
  /** 是否支持 tool 可执行实现 */
  executable: boolean;
}

const COMMANDS: CommandMeta[] = [
  {
    name: "pm-init",
    description: "引导式初始化向导",
    template: "Initialize vibe-pm project with guided questions",
    executable: true,
  },
  {
    name: "pm-install-flow",
    description: "从模板库安装流程",
    template: "Install a flow from template library",
    executable: false, // 声明式，Plugin Core 处理
  },
  {
    name: "pm-uninstall-flow",
    description: "移除一个流程",
    template: "Remove an installed flow",
    executable: false,
  },
  {
    name: "pm-refine-flow",
    description: "迭代优化流程定义",
    template: "Iteratively refine a flow definition",
    executable: false,
  },
  {
    name: "pm-task-start",
    description: "在某个流程下开始新任务",
    template: "Start a new task in the current flow",
    executable: true,
  },
  {
    name: "pm-task-set-step",
    description: "手动跳转到指定步骤",
    template: "Manually jump to a specific step",
    executable: true,
  },
  {
    name: "pm-task-refresh",
    description: "为当前步骤重新注入上下文",
    template: "Re-inject context for the current step",
    executable: true,
  },
  {
    name: "pm-task-close",
    description: "关闭任务，触发分析",
    template: "Close the current task and trigger analysis",
    executable: true,
  },
];

// ─── config hook: 注册命令声明 ───

interface CommandDeclaration {
  template: string;
  description: string;
  agent: string;
}

export function registerCommands(opencodeConfig: Config): void {
  const commands = (opencodeConfig.command ??= {}) as Record<
    string,
    CommandDeclaration
  >;

  for (const cmd of COMMANDS) {
    commands[cmd.name] = {
      template: cmd.template,
      description: cmd.description,
      agent: "build",
    };
  }
}

// ─── tool hook: 注册可执行工具 ───

/**
 * 创建 tool 注册表。使用 SDK tool() 工厂函数 + Zod schema。
 */
export function registerTools(
  _ctx: IPluginContext,
): Record<string, ToolDefinition> {
  const tools: Record<string, ToolDefinition> = {};

  for (const cmd of COMMANDS) {
    if (!cmd.executable) continue;

    tools[cmd.name.replace(/-/g, "_")] = createStubTool(cmd);
  }

  return tools;
}

// ─── Stub 工具实现 ───

function createStubTool(cmd: CommandMeta): ToolDefinition {
  return tool({
    description: cmd.description,
    args: {},
    async execute(
      _args: Record<string, never>,
      _ctx: ToolContext,
    ): Promise<string> {
      return `[vibe-pm] /${cmd.name} - stub: 该命令尚未实现。`;
    },
  });
}

/**
 * 命令注册
 *
 * 通过 config hook（声明式）和 tool hook（可执行）注册全部 8 个 /pm-* 命令。
 * 使用 @opencode-ai/plugin SDK 的 tool() 工厂函数。
 * 可执行命令调用 FlowEngine 和 MemorySystem 实现真实业务逻辑。
 */

import { tool } from "@opencode-ai/plugin";
import type {
  ToolContext,
  ToolDefinition,
  IPluginContext,
  Config,
} from "./types.js";
import { scanTemplates, installTemplate } from "../template/index.js";
import type { FlowEngine } from "../engine/index.js";
import type { MemorySystem } from "../memory/index.js";

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
    name: "pm-install-flow",
    description: "从模板库安装流程",
    template: "Install a flow from template library",
    executable: true,
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
  {
    name: "pm-config",
    description: "查看或修改插件配置",
    template: "View or modify vibe-pm configuration in .vibe-pm.json",
    executable: false,
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
  ctx: IPluginContext,
  engine: FlowEngine,
): Record<string, ToolDefinition> {
  const tools: Record<string, ToolDefinition> = {};

  for (const cmd of COMMANDS) {
    if (!cmd.executable) continue;

      if (cmd.name === "pm-install-flow") {
        tools.pm_install_flow = createInstallFlowTool(ctx);
      } else if (cmd.name === "pm-task-start") {
        tools.pm_task_start = createTaskStartTool(engine);
      } else if (cmd.name === "pm-task-set-step") {
        tools.pm_task_set_step = createTaskSetStepTool(engine);
      } else if (cmd.name === "pm-task-refresh") {
      tools.pm_task_refresh = createTaskRefreshTool(engine);
    } else if (cmd.name === "pm-task-close") {
      tools.pm_task_close = createTaskCloseTool(engine);
    }
  }

  return tools;
}

// ─── 真实工具实现 ───

function createTaskStartTool(engine: FlowEngine): ToolDefinition {
  return tool({
    description: "Start a new task under a flow",
    args: {
      flow: tool.schema.string().describe("流程名称"),
      summary: tool.schema.string().describe("任务摘要（一句话描述任务目标）"),
      specRef: tool.schema.string().optional().describe("关联的 Spec 文档路径"),
      planRef: tool.schema.string().optional().describe("关联的 Plan 文档路径"),
    },
    async execute(
      args: { flow: string; summary: string; specRef?: string; planRef?: string },
      toolCtx: ToolContext,
    ): Promise<string> {
      const sessionId = toolCtx.sessionID;
      if (!sessionId) {
        return "[vibe-pm] 错误：无法获取当前 Session ID。请在新对话中重试。";
      }

      try {
        const task = await engine.startTask({
          sessionId,
          flow: args.flow,
          summary: args.summary,
          specRef: args.specRef,
          planRef: args.planRef,
        });

        return [
          `[vibe-pm] ✅ 任务已手动创建（系统通常会自动创建，此工具为兜底）`,
          `- 流程: ${task.flow}`,
          `- 当前步骤: ${task.currentStep} - ${task.currentStepName}`,
          `- 摘要: ${task.summary}`,
          `- 开始时间: ${task.startAt}`,
        ].join("\n");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "未知错误";
        return `[vibe-pm] ❌ 任务创建失败：${msg}`;
      }
    },
  });
}

function createTaskSetStepTool(engine: FlowEngine): ToolDefinition {
  return tool({
    description: "Manually jump to a specific step",
    args: {
      step: tool.schema.string().describe("目标步骤 ID，如 S1、S2"),
    },
    async execute(
      args: { step: string },
      toolCtx: ToolContext,
    ): Promise<string> {
      const sessionId = toolCtx.sessionID;
      if (!sessionId) {
        return "[vibe-pm] 错误：无法获取当前 Session ID。";
      }

      try {
        await engine.setStep(sessionId, args.step);
        return `[vibe-pm] ✅ 已跳转到步骤 ${args.step}。`;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "未知错误";
        return `[vibe-pm] ❌ 步骤跳转失败：${msg}`;
      }
    },
  });
}

function createTaskRefreshTool(_engine: FlowEngine): ToolDefinition {
  return tool({
    description: "Re-inject context for the current step",
    args: {},
    async execute(
      _args: Record<string, never>,
      _toolCtx: ToolContext,
    ): Promise<string> {
      return "[vibe-pm] 上下文注入已改为文件引用模式。LLM 自行读取 docs/flow/ 和 docs/regulation/ 下的文件。";
    },
  });
}

function createTaskCloseTool(engine: FlowEngine): ToolDefinition {
  return tool({
    description: "Close the current task and trigger analysis",
    args: {},
    async execute(
      _args: Record<string, never>,
      toolCtx: ToolContext,
    ): Promise<string> {
      const sessionId = toolCtx.sessionID;
      if (!sessionId) {
        return "[vibe-pm] 错误：无法获取当前 Session ID。";
      }

      try {
        const task = await engine.closeTask(sessionId);
        if (!task) {
          return "[vibe-pm] 当前无活跃任务，无需关闭。";
        }

        return [
          `[vibe-pm] ✅ 任务已关闭`,
          `- 流程: ${task.flow}`,
          `- 最终步骤: ${task.currentStep} - ${task.currentStepName}`,
          `- 摘要: ${task.summary}`,
          `- 开始时间: ${task.startAt}`,
        ].join("\n");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "未知错误";
        return `[vibe-pm] ❌ 任务关闭失败：${msg}`;
      }
    },
  });
}

// ─── pm-install-flow 实现 ───

function createInstallFlowTool(ctx: IPluginContext): ToolDefinition {
  return tool({
    description: "Install a flow from template library",
    args: {
      templateId: tool.schema.string().optional().describe(
        "Template ID to install (e.g. 'spec-driven-dev', 'bug-fix', 'research', 'large-refactor'). If omitted, lists available templates.",
      ),
    },
    async execute(
      args: { templateId?: string },
      _toolCtx: ToolContext,
    ): Promise<string> {
      if (args.templateId) {
        try {
          installTemplate(ctx.projectDir, args.templateId);
          return `[vibe-pm] 流程 "${args.templateId}" 已成功安装。\n\n已安装到：\n- docs/flow/[flow]${args.templateId}.md\n- 对应的 Command 文件已生成到 .opencode/commands/\n\n⚠️ 新的流程命令需要重启 OpenCode 后才能使用。\n\n重启后可使用对应的 /pm-* 命令启动任务。`;
        } catch (err) {
          const msg =
            err instanceof Error ? err.message : "未知错误";
          return `[vibe-pm] 安装失败：${msg}`;
        }
      }

      const templates = scanTemplates(ctx.projectDir);
      if (templates.length === 0) {
        return "[vibe-pm] 未在 docs/template/ 下找到任何模板。请确认模板目录结构正确。";
      }

      const lines = templates.map(
        (t, i) =>
          `${i + 1}. \`${t.id}\` — ${t.name}（${t.description}）${
            t.command ? `→ \`${t.command}\`` : ""
          }`,
      );

      return `[vibe-pm] 可用的模板列表：\n\n${lines.join("\n")}\n\n要安装一个流程，请运行：\n\`\`\`\n/pm-install-flow templateId: <模板ID>\n\`\`\``;
    },
  });
}

/**
 * 命令注册
 *
 * 通过 config hook（声明式）和 tool hook（可执行）注册全部 8 个 /pm-* 命令。
 * 使用 @opencode-ai/plugin SDK 的 tool() 工厂函数。
 * 可执行命令调用 FlowEngine 和 MemorySystem 实现真实业务逻辑。
 */

import {tool} from "@opencode-ai/plugin";
import * as fs from "node:fs";
import * as path from "node:path";
import {Config, IPluginContext, ToolContext, ToolDefinition} from "./types.js";
import {installTemplate, scanTemplates} from "../template";
import {loadConfig, writeConfig} from "./config.js";
import {writeDcpConfig} from "../integration";
import type {FlowEngine} from "../engine";
import type {MemorySystem} from "../memory";

// ─── 命令清单 ───

interface CommandMeta {
  name: string;
  description: string;
  template?: string;
  /** 是否支持 tool 可执行实现 */
  executable: boolean;
}

const COMMANDS: CommandMeta[] = [
  {
    name: "pm-install-flow",
    description: "从模板库安装流程",
    executable: true,
  },
  {
    name: "pm-uninstall-flow",
    description: "移除一个流程",
    executable: true,
  },
  {
    name: "pm-refine-flow",
    description: "迭代优化流程定义",
    template: "Iteratively refine a flow definition",
    executable: false,
  },
  {
    name: "pm-task-set-step",
    description: "手动跳转到指定步骤",
    executable: true,
  },
  {
    name: "pm-task-close",
    description: "关闭任务，触发分析",
    executable: true,
  },
  {
    name: "pm-task-current-step",
    description: "获取当前活跃任务所在步骤",
    executable: true,
  },
  {
    name: "pm-config",
    description: "查看或修改插件配置",
    executable: true,
  },
];

// ─── register command: 命令注册/注销 ───

interface CommandDeclaration {
  template: string;
  description: string;
  agent: string;
}

export function registerCommands(opencodeConfig: Config): void {
  const commands = (opencodeConfig.command ??= {}) as Record<string, CommandDeclaration>;
  for (const cmd of COMMANDS) {
    if (!cmd.executable) continue;
    commands[cmd.name] = { template: cmd.template || "", description: cmd.description, agent: "build" };
  }
}

// ─── tool hook: 注册可执行工具 ───

/**
 * 创建 tool 注册表。使用 SDK tool() 工厂函数 + Zod schema。
 */
export function registerTools(
  ctx: IPluginContext,
  engine: FlowEngine,
  memory: MemorySystem,
): Record<string, ToolDefinition> {
  const tools: Record<string, ToolDefinition> = {};

  for (const cmd of COMMANDS) {
    if (!cmd.executable) continue;

    if (cmd.name === "pm-install-flow") {
      tools.pm_install_flow = createInstallFlowTool(ctx, engine);
    } else if (cmd.name === "pm-config") {
      tools.pm_config = createConfigTool(ctx);
    } else if (cmd.name === "pm-task-set-step") {
      tools.pm_task_set_step = createTaskSetStepTool(engine, memory);
    } else if (cmd.name === "pm-task-close") {
      tools.pm_task_close = createTaskCloseTool(engine);
    } else if (cmd.name === "pm-task-current-step") {
      tools.pm_task_current_step = createTaskCurrentStepTool(engine, memory);
    }
  }

  return tools;
}

// ─── 真实工具实现 ───

function createTaskSetStepTool(engine: FlowEngine, memory: MemorySystem): ToolDefinition {
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
        return JSON.stringify({ ok: false, error: "无法获取当前 Session ID。" });
      }

      try {
        await engine.setStep(sessionId, args.step);
        const task = await memory.getActiveTask(sessionId);
        if (!task) {
          return JSON.stringify({ ok: false, error: "步骤设置成功但无法获取任务状态。" });
        }
        return JSON.stringify({
          ok: true,
          sessionId: task.sessionId,
          taskId: task.id,
          step: task.currentStep,
          stepName: task.currentStepName,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "未知错误";
        return JSON.stringify({ ok: false, error: msg });
      }
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
        return JSON.stringify({ ok: false, error: "无法获取当前 Session ID。" });
      }

      try {
        const task = await engine.closeTask(sessionId);
        if (!task) {
          return JSON.stringify({ ok: false });
        }

        return JSON.stringify({
          ok: true,
          sessionId: task.sessionId,
          taskId: task.id,
          step: task.currentStep,
          stepName: task.currentStepName,
          flow: task.flow,
          summary: task.summary,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "未知错误";
        return JSON.stringify({ ok: false, error: msg });
      }
    },
  });
}

function createTaskCurrentStepTool(engine: FlowEngine, memory: MemorySystem): ToolDefinition {
  return tool({
    description: "Get the current step of the active task. Returns JSON {ok:false} if no active task.",
    args: {},
    async execute(
      _args: Record<string, never>,
      toolCtx: ToolContext,
    ): Promise<string> {
      const sessionId = toolCtx.sessionID;
      if (!sessionId) {
        return JSON.stringify({ ok: false, error: "无法获取当前 Session ID" });
      }

      try {
        const task = await memory.getActiveTask(sessionId);
        if (!task) {
          return JSON.stringify({ ok: false });
        }
        return JSON.stringify({
          ok: true,
          sessionId: task.sessionId,
          taskId: task.id,
          step: task.currentStep,
          stepName: task.currentStepName,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "未知错误";
        return JSON.stringify({ ok: false, error: msg });
      }
    },
  });
}

// ─── pm-config 实现 ───

function createConfigTool(ctx: IPluginContext): ToolDefinition {
  return tool({
    description: "View or modify vibe-pm configuration",
    args: {
      subCommand: tool.schema
        .string()
        .optional()
        .describe("Sub-command: view, edit, or write-dcp / setup-dcp. Defaults to view."),
      key: tool.schema.string().optional().describe("Config key to edit (for edit sub-command)"),
      value: tool.schema.string().optional().describe("JSON value to set (for edit sub-command)"),
    },
    async execute(
      args: { subCommand?: string; key?: string; value?: string },
      _toolCtx: ToolContext,
    ): Promise<string> {
      const sub = args.subCommand ?? "view";

      if (!["view", "edit", "write-dcp", "setup-dcp"].includes(sub)) {
        return `[vibe-pm] ❌ 未知子命令: "${sub}"。支持: view, edit, write-dcp, setup-dcp`;
      }

      try {
        if (sub === "view") {
          const config = loadConfig(ctx.projectDir);
          return JSON.stringify(config, null, 2);
        }

        if (sub === "edit") {
          if (!args.key) {
            return "[vibe-pm] ❌ edit 子命令需要提供 key 参数";
          }
          if (args.value === undefined) {
            return "[vibe-pm] ❌ edit 子命令需要提供 value 参数";
          }
          const config = loadConfig(ctx.projectDir);
          (config as unknown as Record<string, unknown>)[args.key] = JSON.parse(args.value);
          writeConfig(ctx.projectDir, config);
          return `[vibe-pm] ✅ 配置已更新: ${args.key} = ${args.value}`;
        }

        if (sub === "write-dcp" || sub === "setup-dcp") {
          writeDcpConfig(ctx.projectDir);
          return "[vibe-pm] ✅ DCP 配置已写入";
        }

        return `[vibe-pm] ❌ 未知子命令: "${sub}"`;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "未知错误";
        return `[vibe-pm] ❌ 操作失败：${msg}`;
      }
    },
  });
}

// ─── pm-install-flow 实现 ───

function createInstallFlowTool(
  ctx: IPluginContext,
  engine: FlowEngine,
): ToolDefinition {
  return tool({
    description: "Install a flow from template library",
    args: {
      templateId: tool.schema.string().optional().describe(
        "Template ID to install (e.g. 'spec-driven-dev', 'bug-fix', 'research', 'large-refactor'). If omitted, lists available templates.",
      ),
    },
    async execute(
      args: { templateId?: string },
      toolCtx: ToolContext,
    ): Promise<string> {
      if (args.templateId) {
        try {
          installTemplate(ctx.projectDir, args.templateId);
          return `[vibe-pm] 流程 "${args.templateId}" 已成功安装。\n\n已安装到：\n- docs/flow/flow-${args.templateId}.md\n\n命令 \`/pm-${args.templateId}\` 已就绪。`;
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

// ─── Flow Tool 注册 ───

export function registerFlowTools(
    ctx: IPluginContext,
    engine: FlowEngine,
): Record<string, ToolDefinition> {
  const tools: Record<string, ToolDefinition> = {}
  const flowDir = path.join(ctx.projectDir, "docs", "flow");
  if (!fs.existsSync(flowDir)) return tools;

  for (const file of fs.readdirSync(flowDir)) {
    if (!file.endsWith(".md")) continue;
    try {
      const raw = fs.readFileSync(path.join(flowDir, file), "utf-8");
      const m = raw.match(/\*\*Command\*\*:\s*`?(.+?)`?\s*$/m);
      if (!m) continue;

      const command = m[1].trim();
      const cmdName = command.startsWith("/") ? command.slice(1) : command;
      const flowName = file.replace(/^flow-/, "").replace(/\.md$/, "");


      tools[flowNameToToolKey(flowName)] = createFlowStartTool(ctx, engine, flowName);
    } catch {
      // skip unparseable files
    }
  }
  return tools;
}

function flowNameToToolKey(flowName: string): string {
  return `pm_${flowName.replace(/-/g, "_")}`;
}

function createFlowStartTool(ctx: IPluginContext, engine: FlowEngine, flowName: string): ToolDefinition {
  return tool({
    description: `Start a new task under the "${flowName}" flow`,
    args: {
      summary: tool.schema.string().optional().describe("任务摘要"),
      specRef: tool.schema.string().optional().describe("关联 Spec 文档路径"),
      planRef: tool.schema.string().optional().describe("关联 Plan 文档路径"),
    },
    async execute(
        args: { summary?: string; specRef?: string; planRef?: string },
        toolCtx: ToolContext,
    ): Promise<string> {
      const { sessionID, messageID } = toolCtx;
      if (!sessionID) {
        return JSON.stringify({ ok: false, error: "无法获取当前 Session ID。" });
      }
      if (!messageID) {
        return JSON.stringify({ ok: false, error: "无法获取当前 Message ID。" });
      }

      const response = await ctx.client.session.message({
        path: {
          id: sessionID,
          messageID: messageID,
        },
      });

      const singleMessage = response.data;
      if (!singleMessage || !Array.isArray(singleMessage.parts)) {
        return `Message ${messageID} could not be retrieved directly.`;
      }

      let userRequest = singleMessage.parts
        .filter((p: any) => p.type === "text")
        .map((p: any) => p.text)
        .join("\n");

      try {
        const task = await engine.startTask({
          sessionId: sessionID,
          flow: flowName,
          summary: args.summary ?? "",
          specRef: args.specRef,
          planRef: args.planRef,
          userRequest: userRequest
        });
        return JSON.stringify({
          ok: true,
          sessionId: task.sessionId,
          taskId: task.id,
          step: task.currentStep,
          stepName: task.currentStepName,
          flow: task.flow,
          summary: task.summary,
          startAt: task.startAt,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "未知错误";
        return JSON.stringify({ ok: false, error: msg });
      }
    },
  });
}
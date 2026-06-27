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
import {Config, IPluginContext, PluginConfig, ToolContext, ToolDefinition} from "./types.js";
import {installTemplate, scanTemplates, uninstallFlow} from "../template";
import {loadConfig, writeConfig} from "./config.js";
import {writeDcpConfig} from "../integration";
import type {FlowEngine} from "../engine";
import type {MemorySystem} from "../memory";
import {logger} from "./logger";
import {discoverLanguagePacks} from "../i18n";

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
    template: "Install a flow from template library — call the pm_install_flow tool with templateId",
    executable: true,
  },
  {
    name: "pm-uninstall-flow",
    description: "移除一个流程",
    template: "Remove an installed flow — call the pm_uninstall_flow tool with flowName",
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
    template: "Manually jump to a specific step — call the pm_task_set_step tool with step",
    executable: true,
  },
  {
    name: "pm-task-close",
    description: "关闭任务，触发分析",
    template: "Close the current task and trigger analysis — call the pm_task_close tool",
    executable: true,
  },
  {
    name: "pm-task-current-step",
    description: "获取当前活跃任务所在步骤",
    template: "Get current step of active task — call the pm_task_current_step tool",
    executable: true,
  },
  {
    name: "pm-config",
    description: "查看或修改插件配置",
    template: "View or modify vibe-pm configuration — call the pm_config tool",
    executable: true,
  },
];

// ─── register command: 命令注册/注销 ───

interface CommandDeclaration {
  template: string;
  description: string;
  agent?: string;
}

export function registerCommands(opencodeConfig: Config): void {
  const commands = (opencodeConfig.command ??= {}) as Record<string, CommandDeclaration>;
  for (const cmd of COMMANDS) {
    commands[cmd.name] = { template: cmd.template || "", description: cmd.description };
  }
}

export function registerFlowCommands(opencodeConfig: Config, projectDir: string): void {
  const commands = (opencodeConfig.command ??= {}) as Record<string, CommandDeclaration>;
  const flowDir = path.join(projectDir, "docs", "flow");
  if (!fs.existsSync(flowDir)) return;

  for (const file of fs.readdirSync(flowDir)) {
    if (!file.endsWith(".md")) continue;
    try {
      const raw = fs.readFileSync(path.join(flowDir, file), "utf-8");
      const m = raw.match(/\*\*Command\*\*:\s*`?(.+?)`?\s*$/m);
      if (!m) continue;

      const command = m[1].trim();
      const cmdName = command.startsWith("/") ? command.slice(1) : command;
      const flowName = file.replace(/^flow-/, "").replace(/\.md$/, "");

      commands[cmdName] = {
        template: `Start a task under the "${flowName}" flow — call the pm_${flowName.replace(/-/g, "_")} tool with summary and userRequest`,
        description: `Start a new ${flowName} task by calling the pm_${flowName.replace(/-/g, "_")} tool. Pass the user's original request as userRequest parameter.`,
      };
    } catch {
      // skip unparseable files
    }
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
      tools.pm_install_flow = createInstallFlowTool(ctx);
    } else if (cmd.name === "pm-uninstall-flow") {
      tools.pm_uninstall_flow = createUninstallFlowTool(ctx);
    } else if (cmd.name === "pm-config") {
      tools.pm_config = createConfigTool(ctx);
    } else if (cmd.name === "pm-task-set-step") {
      tools.pm_task_set_step = createTaskSetStepTool(engine, memory);
    } else if (cmd.name === "pm-task-close") {
      tools.pm_task_close = createTaskCloseTool(engine);
    } else if (cmd.name === "pm-task-current-step") {
      tools.pm_task_current_step = createTaskCurrentStepTool(memory);
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

function createTaskCurrentStepTool(memory: MemorySystem): ToolDefinition {
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

function buildInitInstructions(projectDir: string): string {
  const packs = discoverLanguagePacks();
  const languageOptions = packs.map((p) => ({ label: p.label, description: p.locale }));
  const languageOnAnswer: Record<string, { language: string }> = {};
  for (const p of packs) {
    languageOnAnswer[p.label] = { language: p.locale };
  }

  return JSON.stringify({
    flow: "pm-config-init",
    description: "vibe-pm 初始化向导 — 按步骤引导配置项目",
    steps: [
      {
        id: "scope",
        title: "配置范围",
        type: "question",
        instruction: "询问用户 vibe-pm 配置写入位置。opencode 和集成插件配置始终写入项目级。",
        params: {
          header: "配置范围",
          question: "vibe-pm 配置写入哪里？（opencode 和集成插件配置始终项目级 `.opencode/`）",
          options: [
            { label: "项目级", description: "写入项目目录 `./vibe-pm/config.json`" },
            { label: "全局", description: "写入 `~/.config/vibe-pm/config.json`" },
          ],
        },
        onAnswer: {
          "项目级": { configPath: "./vibe-pm/config.json", scope: "project" },
          "全局": { configPath: "~/.config/vibe-pm/config.json", scope: "global" },
        },
      },
      {
        id: "language",
        title: "交互语言",
        type: "question",
        instruction: "写入 PluginConfig.language。",
        params: {
          header: "交互语言",
          question: "选择 vibe-pm 引导流程的交互语言：",
          options: languageOptions,
        },
        onAnswer: languageOnAnswer,
      },
      {
        id: "gitignore",
        title: ".gitignore",
        type: "question",
        instruction: "依次询问是否追加条目到 .gitignore。条目已存在则跳过。使用 bash 追加。",
        params: {
          header: ".gitignore 配置",
          question: "哪些目录需要加入 .gitignore？",
          multiple: true,
          options: [
            { label: ".opencode/", description: "OpenCode 配置目录" },
            { label: ".vibe-pm/", description: "vibe-pm 配置数据目录" },
            { label: ".omo/", description: "oh-my-openagent 计划/配置目录" },
          ],
        },
        skipIfExists: true,
      },
      {
        id: "agents",
        title: "AGENTS.md",
        type: "question",
        instruction: `生成 AGENTS.md。严格按以下优先级规则执行：

1. 确认模板：查找 docs/template/agents-template.md → 插件内置 dist/docs/template/agents-template.md → ../docs/template/agents-template.md

2. 场景 A — 模板存在：
   a) AGENTS.md 不存在 → 按模板格式生成。占位符填充规则：
      - 「概述」「主要功能描述」→ 引导用户填写
      - 「技术栈」「开发环境说明」→ 你分析项目结构后自动推断
   b) AGENTS.md 已存在 → 分析现有结构与模板的差异，使用 question 工具询问用户：
      - 选项 1「完整重写」：按模板格式重写，保留现有 AGENTS.md 中的技术细节
      - 选项 2「补充缺失章节」：仅添加模板中有而现有文件缺失的章节，不改变现有结构
      - 选项 3「跳过」
      ⚠️ 禁止在用户未选择的情况下自行决定"轻量更新"——必须先询问，收到明确选择后再执行

3. 场景 B — 模板不存在：
   a) AGENTS.md 已存在 → 仅追加 Constitution 引用说明（告知后果）
   b) AGENTS.md 不存在 → 告知用户模板缺失，退出此步骤

4. Constitution：无论最终采用哪种方式，完成后告知用户 Constitution 块的约束效果`,
        params: {
          header: "AGENTS.md",
          question: "是否生成 AGENTS.md？使用内置模板，你只需填写项目概述和主要功能描述。技术栈和开发环境由我自动推断。",
          options: [
            { label: "是，生成", description: "使用模板生成" },
            { label: "否，跳过", description: "不生成 AGENTS.md" },
          ],
        },
        checkExists: true,
      },
      {
        id: "dictionary",
        title: "术语字典",
        type: "question",
        instruction: `创建项目术语字典 docs/regulation/dictionary.md（如不存在）。
1. 如果文件已存在，跳过此步骤
2. 如果不存在，先创建 docs/regulation/ 目录，再从 vibe-pm 插件内置模板（查找路径：先试项目 docs/template/dictionary-template.md，不存在则从插件 dist/docs/template/ 读取）复制模板
3. 根据当前项目，分析生成 20 条左右的初始术语记录（中英对照）
4. 在最后的结束总结中提示用户要积极维护字典文档`,
        checkExists: true,
        templateFile: "dictionary-template.md",
        params: {
          header: "术语字典",
          question: "是否创建项目术语字典 (docs/regulation/dictionary.md)？将根据项目生成初始术语记录。",
          options: [
            { label: "是，创建", description: "创建字典并生成初始术语" },
            { label: "否，跳过", description: "不创建字典" },
          ],
        },
      },
      {
        id: "integrations-dcp",
        title: "集成: DCP 插件",
        type: "question",
        instruction: `配置 DCP (Dynamic Context Pruning) 插件。
1. 用 bash 检查全局和项目级 opencode 配置中是否已有 DCP 依赖：~/.config/opencode/opencode.json 和 ./.opencode/opencode.json（或 package.json）
2. 若未安装，询问用户。安装方式：写入 .opencode/opencode.json 的 dependencies`,
        checkInstalled: "opencode-dynamic-context-pruning",
        checkPaths: ["~/.config/opencode/opencode.json", ".opencode/opencode.json"],
        params: {
          header: "DCP 插件",
          question: "是否安装 DCP (Dynamic Context Pruning) 插件？将自动写入 .opencode/opencode.json dependencies。",
          options: [
            { label: "是", description: "安装 DCP 插件" },
            { label: "否", description: "跳过" },
          ],
        },
      },
      {
        id: "integrations-vision",
        title: "集成: Vision Agent",
        type: "question",
        instruction: `配置 Vision Agent（多模态读图子 Agent）。
1. 提供多模态 model 供用户选择：opencode-go/kimi-k2.7-code, opencode/qwen3.6-plus-free, opencode/mimo-v2.5-free
2. 用户选择 model 后，将 agent 配置写入 .opencode/agents/vision-helper.md：

---
description: Resolve images and screenshots to detailed Markdown descriptions
mode: subagent
model: {selected model}
temperature: 0.1
tools:
  write: false
  edit: false
  bash: false
---

你是一个视觉理解专家。你的主要职责是分析主 Agent 传给你的图片或截图，并将其中的 UI 设计、结构、文字或逻辑转化为详细的、结构化的 Markdown 文本描述，以便主 Agent 进行编码。

3. 如果 config.json 不存在，先创建；如果已存在，深度合并（保留现有配置）`,
        checkInstalled: "vision-helper",
        params: {
          header: "Vision Agent",
          question: "是否配置 Vision Agent（多模态读图子 Agent）？将扫描已连接 model 供选择，并写入 agent 配置。",
          options: [
            { label: "是", description: "配置 Vision Agent" },
            { label: "否", description: "跳过" },
          ],
        },
      },
      {
        id: "integrations-code-review",
        title: "集成: Code Review Skill",
        type: "question",
        instruction: `安装 Code Review Skill。
1. 检查是否已安装：查找 ~/.agents/skills/code-review-skill/SKILL.md、~/.claude/skills/code-review-skill/SKILL.md
2. 若未安装，询问用户是否安装。安装方式：
   git clone https://github.com/awesome-skills/code-review-skill ~/.agents/skills/code-review-skill
3. 安装后告知用户重启 OpenCode 后可使用 /code-review-skill 命令`,
        checkInstalled: "code-review-skill",
        params: {
          header: "Code Review Skill",
          question: "是否安装 Code Review Skill？提供全面的代码审查能力。(https://github.com/awesome-skills/code-review-skill)",
          options: [
            { label: "是，安装", description: "克隆到 ~/.agents/skills/code-review-skill" },
            { label: "否，跳过", description: "不安装" },
          ],
        },
      },
      {
        id: "done",
        title: "完成",
        type: "info",
        instruction: "提示用户通过 /pm-install-flow 安装流程模板。",
        message: "✅ 初始化完成！请使用 `/pm-install-flow` 安装需要的流程模板（如 spec-driven-dev、bug-fix 等）。",
      },
    ],
  });
}

function createConfigTool(ctx: IPluginContext): ToolDefinition {
  return tool({
    description: "View or modify vibe-pm configuration",
    args: {
      subCommand: tool.schema
        .string()
        .optional()
        .describe("Sub-command: view, edit, write-dcp, setup-dcp, or init. Defaults to view."),
      key: tool.schema.string().optional().describe("Config key to edit (for edit sub-command)"),
      value: tool.schema.string().optional().describe("JSON value to set (for edit sub-command)"),
    },
    async execute(
      args: { subCommand?: string; key?: string; value?: string },
      _toolCtx: ToolContext,
    ): Promise<string> {
      const sub = args.subCommand ?? "view";

      if (!["view", "edit", "write-dcp", "setup-dcp", "init"].includes(sub)) {
        return `[vibe-pm] ❌ 未知子命令: "${sub}"。支持: view, edit, write-dcp, setup-dcp, init`;
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

        if (sub === "init") {
          return buildInitInstructions(ctx.projectDir);
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

/**
 * 语言选择优先级：tool 参数 > 配置缓存 > General 兜底
 */
function resolveLanguages(
  langParam?: string,
  config?: PluginConfig,
): string[] {
  if (langParam) {
    return langParam.split(",").map((s) => s.trim()).filter(Boolean).map(normalizeLanguage);
  }
  if (config?.programmingLanguages?.length) {
    return config.programmingLanguages;
  }
  return ["General"];
}

/** LLM 可能传入非标准名称，映射到 _coding_style/ 目录中的标准语言名 */
function normalizeLanguage(input: string): string {
  const lower = input.toLowerCase();
  const aliasMap: Record<string, string> = {
    ts: "TypeScript",
    typescript: "TypeScript",
    js: "JavaScript",
    javascript: "JavaScript",
    py: "Python",
    python: "Python",
    go: "Go",
    golang: "Go",
    rs: "Rust",
    rust: "Rust",
    java: "Java",
    kotlin: "Kotlin",
    rb: "Ruby",
    ruby: "Ruby",
    ex: "Elixir",
    elixir: "Elixir",
    c: "C/C++",
    "c++": "C/C++",
    cpp: "C/C++",
  };
  return aliasMap[lower] ?? input;
}

function createInstallFlowTool(
  ctx: IPluginContext,
): ToolDefinition {
  return tool({
    description: "Install a flow from template library",
    args: {
      templateId: tool.schema.string().optional().describe(
        "Template ID to install (e.g. 'spec-driven-dev', 'bug-fix', 'research', 'large-refactor'). If omitted, lists available templates.",
      ),
      programmingLanguages: tool.schema.string().optional().describe(
        "逗号分隔的编程语言列表，由 LLM 分析项目结构后提供。支持: TypeScript, Python, Go, Rust, Java, JavaScript, Kotlin, Ruby, Elixir, C/C++。如 'TypeScript,Go'。若省略，从配置缓存读取；无配置时使用 General。",
      ),
      overwrite: tool.schema.boolean().optional().describe(
        "是否覆盖已存在的 flow 文档（默认 false，已存在时返回提示让用户确认）。",
      ),
    },
    async execute(
      args: { templateId?: string; programmingLanguages?: string; overwrite?: boolean },
      _toolCtx: ToolContext,
    ): Promise<string> {
      if (args.templateId) {
        try {
          const config = loadConfig(ctx.projectDir);
          const languages = resolveLanguages(args.programmingLanguages, config);

          installTemplate(ctx.projectDir, args.templateId, languages, args.overwrite);

          // 将 LLM 分析结果写回配置，后续安装复用
          if (languages.length > 0 && languages[0] !== "General") {
            config.programmingLanguages = languages;
            writeConfig(ctx.projectDir, config);
          }

          return `[vibe-pm] 流程 "${args.templateId}" 已成功安装。\n\n已安装到：\n- docs/flow/flow-${args.templateId}.md\n\n⚠️ 请重启 OpenCode 后使用 \`/pm-${args.templateId}\` 命令启动任务。`;
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

// ─── pm-uninstall-flow 实现 ───

function createUninstallFlowTool(ctx: IPluginContext): ToolDefinition {
  return tool({
    description: "Remove an installed flow and its command",
    args: {
      flowName: tool.schema.string().describe("要移除的流程名称（如 spec-driven-dev）"),
    },
    async execute(
      args: { flowName: string },
      _toolCtx: ToolContext,
    ): Promise<string> {
      try {
        uninstallFlow(ctx.projectDir, args.flowName);
        return `[vibe-pm] 流程 "${args.flowName}" 已移除。\n\n⚠️ 请重启 OpenCode 使变更生效。`;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "未知错误";
        return `[vibe-pm] 卸载失败：${msg}`;
      }
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
      const flowName = file.replace(/^flow-/, "").replace(/\.md$/, "");
      logger.info(`registerFlowTools: found flow ${flowName}`)
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
  function extractText(parts: Array<any>): string {
    return parts
      .filter((p: any) => p.type === "text")
      .map((p: any) => p.text)
      .join("\n");
  }

  return tool({
    description: `Start a new task under the "${flowName}" flow. Call this tool BEFORE any analysis or implementation. Pass the user's original request as userRequest.`,
    args: {
      summary: tool.schema.string().optional().describe("任务摘要"),
      userRequest: tool.schema.string().optional().describe("用户原始请求全文 — 务必传递以保存任务上下文和去重")
    },
    async execute(
        args: { summary?: string; userRequest?: string; },
      _toolCtx: ToolContext,
    ): Promise<string> {
      const { sessionID, messageID } = _toolCtx;
      if (!sessionID) {
        logger.warn(`createFlowStartTool(${flowName}): no sessionID`);
        return JSON.stringify({ ok: false, error: "无法获取当前 Session ID。" });
      }

      logger.info(`createFlowStartTool(${flowName}): sessionID=${sessionID} messageID=${messageID ?? "N/A"} summary=${args.summary ?? "N/A"} userRequest=${args.userRequest ? "provided" : "extracting"}`);

      // ── Extract userRequest ──
      let userRequest = args.userRequest ?? "";

      // 1) If not provided, try the message that triggered the tool (messageID from ToolContext)
      if (!userRequest && messageID) {
        logger.info(`createFlowStartTool(${flowName}): trying message fetch via messageID=${messageID}`);
        try {
          const response = await ctx.client.session.message({
            path: { id: sessionID, messageID },
          });
          const msg = response.data;
          if (msg && Array.isArray((msg as any).parts)) {
            userRequest = extractText((msg as any).parts);
            logger.info(`createFlowStartTool(${flowName}): extracted from message, len=${userRequest.length}`);
          }
        } catch (err) {
          logger.warn(`createFlowStartTool(${flowName}): message fetch failed: ${err}`);
        }
      }

      // 2) Fallback: list recent session messages, pick the latest user message
      if (!userRequest) {
        logger.info(`createFlowStartTool(${flowName}): trying session messages list`);
        try {
          const msgsResponse = await ctx.client.session.messages({
            path: { id: sessionID },
            query: { limit: 5 },
          });
          const messages = msgsResponse.data;
          if (Array.isArray(messages)) {
            for (let i = messages.length - 1; i >= 0; i--) {
              const m = messages[i] as any;
              const role = m.info?.role;
              if (role === "user") {
                userRequest = extractText(m.parts ?? []);
                logger.info(`createFlowStartTool(${flowName}): extracted from session messages[${i}], len=${userRequest.length}`);
                break;
              }
            }
          }
        } catch (err) {
          logger.warn(`createFlowStartTool(${flowName}): session messages fetch failed: ${err}`);
        }
      }

      // 3) Final fallback: use summary
      if (!userRequest && args.summary) {
        logger.info(`createFlowStartTool(${flowName}): fallback to summary as userRequest`);
        userRequest = args.summary;
      }

      logger.info(`createFlowStartTool(${flowName}): final userRequest len=${userRequest.length}`);

      const summary = args.summary || "";

      try {
        const task = await engine.startTask({
          sessionId: sessionID,
          flow: flowName,
          summary,
          userRequest,
        });
        logger.info(`createFlowStartTool(${flowName}): task created id=${task.id} step=${task.currentStep}`);
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
        logger.error(`createFlowStartTool(${flowName}): startTask failed: ${msg}`);
        return JSON.stringify({ ok: false, error: msg });
      }
    },
  });
}
/**
 * Command Registration
 *
 * Registers all 8 /pm-* commands via the config hook (declarative) and
 * tool hook (executable). Uses the @opencode-ai/plugin SDK tool() factory.
 * Executable commands invoke FlowEngine and MemorySystem for real business logic.
 */

import { tool } from '@opencode-ai/plugin';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Config, IPluginContext, PluginConfig, ToolContext, ToolDefinition } from './types.js';
import { installTemplate, scanTemplates, uninstallFlow } from '../template';
import { loadConfig, writeConfig } from './config.js';
import type { FlowEngine } from '../engine';
import type { MemorySystem } from '../memory';
import { logger } from './logger';
import { discoverLanguagePacks, getControlPromptTemplate, i18n } from '../i18n';

// ─── Command List ───

interface CommandMeta {
  name: string;
  template?: string;
  /** Whether the command supports executable tool implementation */
  executable: boolean;
}

const COMMANDS: CommandMeta[] = [
  {
    name: 'pm-install-flow',
    template:
      'Install a flow from template library — call the pm_install_flow tool with templateId',
    executable: true,
  },
  {
    name: 'pm-uninstall-flow',
    template: 'Remove an installed flow — call the pm_uninstall_flow tool with flowName',
    executable: true,
  },
  {
    name: 'pm-refine-flow',
    template: 'Refine a flow definition under `docs/flow/`',
    executable: false,
  },
  {
    name: 'pm-task-set-step',
    template: 'Manually jump to a specific step — call the pm_task_set_step tool with step',
    executable: true,
  },
  {
    name: 'pm-task-close',
    template: 'Close the current task and trigger analysis — call the pm_task_close tool',
    executable: true,
  },
  {
    name: 'pm-task-current-step',
    template: 'Get current step of active task — call the pm_task_current_step tool',
    executable: true,
  },
  {
    name: 'pm-config',
    template: 'View or modify vibe-pm configuration — call the pm_config tool',
    executable: true,
  },
];

// ─── register command: Command Registration/Unregistration ───

interface CommandDeclaration {
  template: string;
  description: string;
  agent?: string;
}

export function registerCommands(opencodeConfig: Config): void {
  const commands = (opencodeConfig.command ??= {}) as Record<string, CommandDeclaration>;
  const descMap = i18n().tool.commandDesc;
  for (const cmd of COMMANDS) {
    commands[cmd.name] = {
      template: cmd.template || '',
      description: descMap[cmd.name] ?? cmd.name,
    };
  }
}

export function registerFlowCommands(opencodeConfig: Config, projectDir: string): void {
  const commands = (opencodeConfig.command ??= {}) as Record<string, CommandDeclaration>;
  const flowDir = path.join(projectDir, 'docs', 'flow');
  if (!fs.existsSync(flowDir)) return;

  for (const file of fs.readdirSync(flowDir)) {
    if (!file.endsWith('.md')) continue;
    try {
      const raw = fs.readFileSync(path.join(flowDir, file), 'utf-8');
      const m = raw.match(/\*\*Command\*\*:\s*`?(.+?)`?\s*$/m);
      if (!m) continue;

      const command = m[1].trim();
      const cmdName = command.startsWith('/') ? command.slice(1) : command;
      const flowName = file.replace(/^flow-/, '').replace(/\.md$/, '');

      commands[cmdName] = {
        template: `Start a task under the "${flowName}" flow — call the pm_${flowName.replace(/-/g, '_')} tool with summary and userRequest`,
        description: `Start a new ${flowName} task by calling the pm_${flowName.replace(/-/g, '_')} tool. Pass the user's original request as userRequest parameter.`,
      };
    } catch {
      // skip unparseable files
    }
  }
}

// ─── tool hook: Register Executable Tools ───

/**
 * Create tool registry using the SDK tool() factory + Zod schemas.
 */
export function registerTools(
  ctx: IPluginContext,
  engine: FlowEngine,
  memory: MemorySystem
): Record<string, ToolDefinition> {
  const tools: Record<string, ToolDefinition> = {};

  for (const cmd of COMMANDS) {
    if (!cmd.executable) continue;

    if (cmd.name === 'pm-install-flow') {
      tools.pm_install_flow = createInstallFlowTool(ctx);
    } else if (cmd.name === 'pm-uninstall-flow') {
      tools.pm_uninstall_flow = createUninstallFlowTool(ctx);
    } else if (cmd.name === 'pm-config') {
      tools.pm_config = createConfigTool(ctx);
    } else if (cmd.name === 'pm-task-set-step') {
      tools.pm_task_set_step = createTaskSetStepTool(engine, memory);
    } else if (cmd.name === 'pm-task-close') {
      tools.pm_task_close = createTaskCloseTool(engine);
    } else if (cmd.name === 'pm-task-current-step') {
      tools.pm_task_current_step = createTaskCurrentStepTool(memory);
    }
  }

  return tools;
}

// ─── Real Tool Implementations ───

function createTaskSetStepTool(engine: FlowEngine, memory: MemorySystem): ToolDefinition {
  const cmdI18n = i18n().tool;
  return tool({
    description: cmdI18n.commandDesc['pm-task-set-step'] ?? 'Manually jump to a specific step',
    args: {
      step: tool.schema.string().describe('Target step ID, e.g. S1, S2'),
    },
    async execute(args: { step: string }, toolCtx: ToolContext): Promise<string> {
      const sessionId = toolCtx.sessionID;
      if (!sessionId) {
        return JSON.stringify({ ok: false, error: cmdI18n.flowStartNoSession });
      }

      try {
        await engine.setStep(sessionId, args.step);
        const task = await memory.getActiveTask(sessionId);
        if (!task) {
          return JSON.stringify({ ok: false, error: cmdI18n.setStepNoTask });
        }
        return JSON.stringify({
          ok: true,
          sessionId: task.sessionId,
          taskId: task.id,
          step: task.currentStep,
          stepName: task.currentStepName,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : cmdI18n.unknownError;
        return JSON.stringify({ ok: false, error: msg });
      }
    },
  });
}

function createTaskCloseTool(engine: FlowEngine): ToolDefinition {
  const cmdI18n = i18n().tool;
  return tool({
    description:
      cmdI18n.commandDesc['pm-task-close'] ?? 'Close the current task and trigger analysis',
    args: {},
    async execute(_args: Record<string, never>, toolCtx: ToolContext): Promise<string> {
      const sessionId = toolCtx.sessionID;
      if (!sessionId) {
        return JSON.stringify({ ok: false, error: cmdI18n.flowStartNoSession });
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
        const msg = err instanceof Error ? err.message : cmdI18n.unknownError;
        return JSON.stringify({ ok: false, error: msg });
      }
    },
  });
}

function createTaskCurrentStepTool(memory: MemorySystem): ToolDefinition {
  const cmdI18n = i18n().tool;
  return tool({
    description:
      cmdI18n.commandDesc['pm-task-current-step'] ??
      'Get the current step of the active task. Returns JSON {ok:false} if no active task.',
    args: {},
    async execute(_args: Record<string, never>, toolCtx: ToolContext): Promise<string> {
      const sessionId = toolCtx.sessionID;
      if (!sessionId) {
        return JSON.stringify({ ok: false, error: cmdI18n.noSessionIdShort });
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
        const msg = err instanceof Error ? err.message : cmdI18n.unknownError;
        return JSON.stringify({ ok: false, error: msg });
      }
    },
  });
}

// ─── pm-config Implementation ───

async function buildInitInstructions(
  projectDir: string,
  selectedLanguage?: string
): Promise<string> {
  const config = loadConfig(projectDir);
  const packs = discoverLanguagePacks();

  if (selectedLanguage) {
    const i18n = getControlPromptTemplate(selectedLanguage);
    return i18n.buildInitRemainingSteps(packs);
  }

  const i18n = getControlPromptTemplate(config.language);
  return i18n.buildInitInstructions(packs);
}

function createConfigTool(ctx: IPluginContext): ToolDefinition {
  const cmdI18n = i18n().tool;
  return tool({
    description: cmdI18n.commandDesc['pm-config'] ?? 'View or modify vibe-pm configuration',
    args: {
      subCommand: tool.schema
        .string()
        .optional()
        .describe('Sub-command: view, edit, or init. Defaults to view.'),
      key: tool.schema.string().optional().describe('Config key to edit (for edit sub-command)'),
      value: tool.schema.string().optional().describe('JSON value to set (for edit sub-command)'),
      language: tool.schema
        .string()
        .optional()
        .describe(
          'Selected interactive language locale (for init sub-command). DO NOT provide this parameter automatically — it must ONLY be set after user explicitly chooses a language via the question tool. When provided, init returns remaining steps in this language.'
        ),
    },
    async execute(
      args: { subCommand?: string; key?: string; value?: string; language?: string },
      _toolCtx: ToolContext
    ): Promise<string> {
      const sub = args.subCommand ?? 'view';

      if (!['view', 'edit', 'init'].includes(sub)) {
        return cmdI18n.unknownSubCommand(sub);
      }

      try {
        if (sub === 'view') {
          const config = loadConfig(ctx.projectDir);
          return JSON.stringify(config, null, 2);
        }

        if (sub === 'edit') {
          if (!args.key) {
            return cmdI18n.editNeedKey;
          }
          if (args.value === undefined) {
            return cmdI18n.editNeedValue;
          }
          const config = loadConfig(ctx.projectDir);
          (config as unknown as Record<string, unknown>)[args.key] = JSON.parse(args.value);
          writeConfig(ctx.projectDir, config);
          return cmdI18n.configUpdated(args.key, args.value);
        }

        if (sub === 'init') {
          return await buildInitInstructions(ctx.projectDir, args.language);
        }

        return cmdI18n.unknownSubCommand(sub);
      } catch (err) {
        const msg = err instanceof Error ? err.message : cmdI18n.unknownError;
        return cmdI18n.operationFailed(msg);
      }
    },
  });
}

// ─── pm-install-flow Implementation ───

/**
 * Language selection priority: tool param > config cache > General fallback
 */
function resolveLanguages(langParam?: string, config?: PluginConfig): string[] {
  if (langParam) {
    return langParam
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map(normalizeLanguage);
  }
  if (config?.programmingLanguages?.length) {
    return config.programmingLanguages;
  }
  return ['General'];
}

/** LLM may pass non-standard names; map them to canonical language names in the _coding_style/ directory */
function normalizeLanguage(input: string): string {
  const lower = input.toLowerCase();
  const aliasMap: Record<string, string> = {
    ts: 'TypeScript',
    typescript: 'TypeScript',
    js: 'JavaScript',
    javascript: 'JavaScript',
    py: 'Python',
    python: 'Python',
    go: 'Go',
    golang: 'Go',
    rs: 'Rust',
    rust: 'Rust',
    java: 'Java',
    kotlin: 'Kotlin',
    rb: 'Ruby',
    ruby: 'Ruby',
    ex: 'Elixir',
    elixir: 'Elixir',
    c: 'C/C++',
    'c++': 'C/C++',
    cpp: 'C/C++',
  };
  return aliasMap[lower] ?? input;
}

function createInstallFlowTool(ctx: IPluginContext): ToolDefinition {
  const cmdI18n = i18n().tool;
  return tool({
    description: cmdI18n.commandDesc['pm-install-flow'] ?? 'Install a flow from template library',
    args: {
      templateId: tool.schema
        .string()
        .optional()
        .describe(
          "Template ID to install (e.g. 'spec-driven-dev', 'bug-fix', 'research', 'large-refactor'). If omitted, lists available templates."
        ),
      programmingLanguages: tool.schema
        .string()
        .optional()
        .describe(
          "Comma-separated programming language list, provided by LLM after analyzing project structure. Supports: TypeScript, Python, Go, Rust, Java, JavaScript, Kotlin, Ruby, Elixir, C/C++. e.g. 'TypeScript,Go'. When omitted, reads from config cache; falls back to General."
        ),
      overwrite: tool.schema
        .boolean()
        .optional()
        .describe(
          'Whether to overwrite existing flow docs (default false; prompts user to confirm when files exist).'
        ),
    },
    async execute(
      args: { templateId?: string; programmingLanguages?: string; overwrite?: boolean },
      _toolCtx: ToolContext
    ): Promise<string> {
      if (args.templateId) {
        try {
          const config = loadConfig(ctx.projectDir);
          const languages = resolveLanguages(args.programmingLanguages, config);

          const i18n = getControlPromptTemplate(config.language);
          const result = installTemplate(ctx.projectDir, args.templateId, {
            programmingLanguages: languages,
            overwrite: args.overwrite,
            locale: config.language,
          });

          if (languages.length > 0 && languages[0] !== 'General') {
            config.programmingLanguages = languages;
            writeConfig(ctx.projectDir, config);
          }

          const needsTranslation = config.language !== 'en-US';
          let response = i18n.tool.installSuccess(args.templateId);

          if (needsTranslation && result.flowPath) {
            response += `\n\n${i18n.tool.installStartHint}`;
            response += `\n- Flow: ${result.flowPath}`;
            for (const rp of result.regulationPaths) {
              response += `\n- Regulation: ${rp}`;
            }
            for (const cp of result.codingStylePaths) {
              response += `\n- Coding Style: ${cp}`;
            }
            if (result.dictionaryPath) {
              response += `\n- Dictionary: ${result.dictionaryPath} (${i18n.tool.translateDictNote})`;
            }
          }

          return response;
        } catch (err) {
          const msg = err instanceof Error ? err.message : '未知错误';
          const config = loadConfig(ctx.projectDir);
          const i18n = getControlPromptTemplate(config.language);
          return i18n.tool.installFailure(msg);
        }
      }

      const templates = scanTemplates(ctx.projectDir);
      if (templates.length === 0) {
        return cmdI18n.noTemplatesFound;
      }

      const lines = templates.map(
        (t, i) =>
          `${i + 1}. \`${t.id}\` — ${t.name}（${t.description}）${
            t.command ? `→ \`${t.command}\`` : ''
          }`
      );

      return cmdI18n.templateList(lines.join('\n'));
    },
  });
}

// ─── pm-uninstall-flow Implementation ───

function createUninstallFlowTool(ctx: IPluginContext): ToolDefinition {
  const cmdI18n = i18n().tool;
  return tool({
    description:
      cmdI18n.commandDesc['pm-uninstall-flow'] ?? 'Remove an installed flow and its command',
    args: {
      flowName: tool.schema.string().describe('Flow name to remove (e.g. spec-driven-dev)'),
    },
    async execute(args: { flowName: string }, _toolCtx: ToolContext): Promise<string> {
      try {
        uninstallFlow(ctx.projectDir, args.flowName);
        return cmdI18n.uninstallSuccess(args.flowName);
      } catch (err) {
        const msg = err instanceof Error ? err.message : cmdI18n.unknownError;
        return cmdI18n.uninstallFailure(msg);
      }
    },
  });
}

// ─── Flow Tool Registration ───

export function registerFlowTools(
  ctx: IPluginContext,
  engine: FlowEngine
): Record<string, ToolDefinition> {
  const tools: Record<string, ToolDefinition> = {};
  const flowDir = path.join(ctx.projectDir, 'docs', 'flow');
  if (!fs.existsSync(flowDir)) return tools;

  for (const file of fs.readdirSync(flowDir)) {
    if (!file.endsWith('.md')) continue;
    try {
      const flowName = file.replace(/^flow-/, '').replace(/\.md$/, '');
      logger.info(`registerFlowTools: found flow ${flowName}`);
      tools[flowNameToToolKey(flowName)] = createFlowStartTool(ctx, engine, flowName);
    } catch {
      // skip unparseable files
    }
  }
  return tools;
}

function flowNameToToolKey(flowName: string): string {
  return `pm_${flowName.replace(/-/g, '_')}`;
}

function createFlowStartTool(
  ctx: IPluginContext,
  engine: FlowEngine,
  flowName: string
): ToolDefinition {
  const cmdI18n = i18n().tool;

  function extractText(parts: Array<any>): string {
    return parts
      .filter((p: any) => p.type === 'text')
      .map((p: any) => p.text)
      .join('\n');
  }

  return tool({
    description: `Start a new task under the "${flowName}" flow. Call this tool BEFORE any analysis or implementation. Pass the user's original request as userRequest.`,
    args: {
      summary: tool.schema.string().optional().describe('任务摘要'),
      userRequest: tool.schema
        .string()
        .optional()
        .describe('用户原始请求全文 — 务必传递以保存任务上下文和去重'),
    },
    async execute(
      args: { summary?: string; userRequest?: string },
      _toolCtx: ToolContext
    ): Promise<string> {
      const { sessionID, messageID } = _toolCtx;
      if (!sessionID) {
        logger.warn(`createFlowStartTool(${flowName}): no sessionID`);
        return JSON.stringify({ ok: false, error: cmdI18n.flowStartNoSession });
      }

      logger.info(
        `createFlowStartTool(${flowName}): sessionID=${sessionID} messageID=${messageID ?? 'N/A'} summary=${args.summary ?? 'N/A'} userRequest=${args.userRequest ? 'provided' : 'extracting'}`
      );

      // ── Extract userRequest ──
      let userRequest = args.userRequest ?? '';

      // 1) If not provided, try the message that triggered the tool (messageID from ToolContext)
      if (!userRequest && messageID) {
        logger.info(
          `createFlowStartTool(${flowName}): trying message fetch via messageID=${messageID}`
        );
        try {
          const response = await ctx.client.session.message({
            path: { id: sessionID, messageID },
          });
          const msg = response.data;
          if (msg && Array.isArray((msg as any).parts)) {
            userRequest = extractText((msg as any).parts);
            logger.info(
              `createFlowStartTool(${flowName}): extracted from message, len=${userRequest.length}`
            );
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
              if (role === 'user') {
                userRequest = extractText(m.parts ?? []);
                logger.info(
                  `createFlowStartTool(${flowName}): extracted from session messages[${i}], len=${userRequest.length}`
                );
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

      const summary = args.summary || '';

      try {
        const task = await engine.startTask({
          sessionId: sessionID,
          flow: flowName,
          summary,
          userRequest,
        });
        logger.info(
          `createFlowStartTool(${flowName}): task created id=${task.id} step=${task.currentStep}`
        );
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
        const msg = err instanceof Error ? err.message : cmdI18n.unknownError;
        logger.error(`createFlowStartTool(${flowName}): startTask failed: ${msg}`);
        return JSON.stringify({ ok: false, error: msg });
      }
    },
  });
}

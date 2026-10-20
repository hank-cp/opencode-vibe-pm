/**
 * Command & Tool Registration (OpenCode V2)
 *
 * Registers all /pm-* commands through `ctx.command.transform` and all pm_* tools
 * through `ctx.tool.transform`. Both transforms must stay synchronous and side-effect
 * free, so this module only builds editor entries — the real work happens later in
 * `execute`, which receives the plugin's narrow `IPluginContext`.
 *
 * Schemas are plain JSON Schema literals: the project's zod@3.23 does not satisfy
 * StandardSchemaV1, and V2 requires `JsonSchema | StandardSchemaV1 | effect Codec`.
 * Arguments are therefore read from `unknown` through explicit type guards.
 */

import type { JsonSchema } from 'effect';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SessionDomain } from '@opencode/plugin/promise/session';
import {
  CommandEditor,
  IPluginContext,
  PluginConfig,
  SessionMessageInfo,
  ToolContext,
  ToolEditor,
  ToolInfo,
  ToolResult,
} from './types.js';
import {
  installTemplate,
  installAllTemplates,
  scanTemplates,
  uninstallFlow,
  getPluginTemplateDir,
  installCodingStyleFromTemplate,
} from '../template';
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
      'Install a flow from template library — call the pm_install_flow tool. ' +
      'Pass templateId for a single template. When the user asks to install ALL built-in flows ' +
      '(e.g. "all", "全部", "所有内置流程"), pass all=true instead of templateId ' +
      '— never pass "all" as a templateId.',
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

/** The slice of the V2 session domain command handlers need to deliver a prompt. */
type CommandSession = Pick<SessionDomain, 'prompt'>;

// ─── Command Registration ───

export function registerCommands(editor: CommandEditor, session: CommandSession): void {
  const descMap = i18n().tool.commandDesc;
  for (const cmd of COMMANDS) {
    editor.add({
      name: cmd.name,
      description: descMap[cmd.name] ?? cmd.name,
      execute: async (input) => {
        const template = cmd.template ?? '';
        await session.prompt({
          ...input.prompt,
          sessionID: input.sessionID,
          text: `${template}\n\n${input.prompt.text}`,
          delivery: input.delivery,
        });
      },
    });
  }
}

export function registerFlowCommands(
  editor: CommandEditor,
  projectDir: string,
  session: CommandSession,
): void {
  const flowDir = path.join(projectDir, 'docs', 'flow');
  if (!fs.existsSync(flowDir)) return;

  for (const file of fs.readdirSync(flowDir)) {
    if (!file.endsWith('.md')) continue;
    try {
      const raw = fs.readFileSync(path.join(flowDir, file), 'utf-8');
      const m = raw.match(/\*\*Command\*\*:\s*`?(.+?)`?\s*$/m);
      if (!m || !m[1]) continue;

      const command = m[1].trim();
      const cmdName = command.startsWith('/') ? command.slice(1) : command;
      const flowName = file.replace(/^flow-/, '').replace(/\.md$/, '');
      const template = `Start a task under the "${flowName}" flow — call the pm_${flowName.replace(/-/g, '_')} tool with summary and userRequest`;

      editor.add({
        name: cmdName,
        description: `Start a new ${flowName} task by calling the pm_${flowName.replace(/-/g, '_')} tool. Pass the user's original request as userRequest parameter.`,
        execute: async (input) => {
          await session.prompt({
            ...input.prompt,
            sessionID: input.sessionID,
            text: `${template}\n\n${input.prompt.text}`,
            delivery: input.delivery,
          });
        },
      });
    } catch {
      // skip unparseable files
    }
  }
}

// ─── Argument Guards ───

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function argString(input: unknown, key: string): string | undefined {
  if (!isRecord(input)) return undefined;
  const value = input[key];
  return typeof value === 'string' ? value : undefined;
}

function argBoolean(input: unknown, key: string): boolean | undefined {
  if (!isRecord(input)) return undefined;
  const value = input[key];
  return typeof value === 'boolean' ? value : undefined;
}

function reply(payload: unknown): ToolResult {
  return { content: JSON.stringify(payload) };
}

// ─── Tool Registration ───

export function registerTools(
  editor: ToolEditor,
  ctx: IPluginContext,
  engine: FlowEngine,
  memory: MemorySystem,
): void {
  const tools: ToolInfo[] = [];

  for (const cmd of COMMANDS) {
    if (!cmd.executable) continue;

    if (cmd.name === 'pm-install-flow') {
      tools.push(createInstallFlowTool(ctx));
    } else if (cmd.name === 'pm-uninstall-flow') {
      tools.push(createUninstallFlowTool(ctx));
    } else if (cmd.name === 'pm-config') {
      tools.push(createConfigTool(ctx));
    } else if (cmd.name === 'pm-task-set-step') {
      tools.push(createTaskSetStepTool(engine, memory));
    } else if (cmd.name === 'pm-task-close') {
      tools.push(createTaskCloseTool(engine));
    } else if (cmd.name === 'pm-task-current-step') {
      tools.push(createTaskCurrentStepTool(memory));
    }
  }

  tools.push(createVerifyOutputTool(engine));

  for (const tool of tools) editor.add(tool);
  logger.info(`registering tools: ${tools.map((t) => t.name)}`);
}

// ─── Real Tool Implementations ───

function createTaskSetStepTool(engine: FlowEngine, memory: MemorySystem): ToolInfo {
  const cmdI18n = i18n().tool;
  const input: JsonSchema.JsonSchema = {
    type: 'object',
    properties: {
      step: { type: 'string', description: 'Target step ID, e.g. S1, S2' },
      force: {
        type: 'boolean',
        description:
          'Set true ONLY when the user explicitly requested to skip steps; bypasses FSM transition validation',
      },
    },
    required: ['step'],
  };

  return {
    name: 'pm_task_set_step',
    description:
      'Manually jump to a specific step. Pass force=true ONLY when the user explicitly requested to skip steps; it bypasses FSM transition validation (the target step must still exist in the flow document)',
    input,
    async execute(raw: unknown, toolCtx: ToolContext): Promise<ToolResult> {
      const sessionId = toolCtx.sessionID;
      if (!sessionId) {
        return reply({ ok: false, error: cmdI18n.flowStartNoSession });
      }

      const step = argString(raw, 'step') ?? '';
      const force = argBoolean(raw, 'force') === true;

      try {
        const result = await engine.setStep(sessionId, step, force);
        if (!result.ok) {
          return reply({
            ok: false,
            error: result.warning ?? cmdI18n.unknownError,
            legalTargets: result.legalTargets ?? [],
          });
        }
        const task = await memory.getActiveTask(sessionId);
        if (!task) {
          return reply({ ok: false, error: cmdI18n.setStepNoTask });
        }
        return reply({
          ok: true,
          sessionId: task.sessionId,
          taskId: task.id,
          step: task.currentStep,
          stepName: task.currentStepName,
          forced: force,
          notice: result.notice,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : cmdI18n.unknownError;
        return reply({ ok: false, error: msg });
      }
    },
  };
}

function createTaskCloseTool(engine: FlowEngine): ToolInfo {
  const cmdI18n = i18n().tool;
  const input: JsonSchema.JsonSchema = { type: 'object', properties: {} };

  return {
    name: 'pm_task_close',
    description:
      cmdI18n.commandDesc['pm-task-close'] ?? 'Close the current task and trigger analysis',
    input,
    async execute(_raw: unknown, toolCtx: ToolContext): Promise<ToolResult> {
      const sessionId = toolCtx.sessionID;
      if (!sessionId) {
        return reply({ ok: false, error: cmdI18n.flowStartNoSession });
      }

      try {
        const task = await engine.closeTask(sessionId);
        if (!task) {
          return reply({ ok: false });
        }

        return reply({
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
        return reply({ ok: false, error: msg });
      }
    },
  };
}

function createTaskCurrentStepTool(memory: MemorySystem): ToolInfo {
  const cmdI18n = i18n().tool;
  const input: JsonSchema.JsonSchema = { type: 'object', properties: {} };

  return {
    name: 'pm_task_current_step',
    description:
      cmdI18n.commandDesc['pm-task-current-step'] ??
      'Get the current step of the active task. Returns JSON {ok:false} if no active task.',
    input,
    async execute(_raw: unknown, toolCtx: ToolContext): Promise<ToolResult> {
      const sessionId = toolCtx.sessionID;
      if (!sessionId) {
        return reply({ ok: false, error: cmdI18n.noSessionIdShort });
      }

      try {
        const task = await memory.getActiveTask(sessionId);
        if (!task) {
          return reply({ ok: false });
        }
        return reply({
          ok: true,
          sessionId: task.sessionId,
          taskId: task.id,
          step: task.currentStep,
          stepName: task.currentStepName,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : cmdI18n.unknownError;
        return reply({ ok: false, error: msg });
      }
    },
  };
}

function createVerifyOutputTool(engine: FlowEngine): ToolInfo {
  const cmdI18n = i18n().tool;
  const input: JsonSchema.JsonSchema = { type: 'object', properties: {} };

  return {
    name: 'pm_task_verify',
    description:
      'Declare the current step output as complete and request the verification flow configured for that step (self-check checklist / review agent / human review). Acts on the active task\'s current step. Use this when a step\'s work is done before moving to the next step.',
    input,
    async execute(_raw: unknown, toolCtx: ToolContext): Promise<ToolResult> {
      const sessionId = toolCtx.sessionID;
      if (!sessionId) {
        return reply({ ok: false, error: cmdI18n.noSessionIdShort });
      }

      try {
        return reply(await engine.verifyOutput(sessionId));
      } catch (err) {
        const msg = err instanceof Error ? err.message : cmdI18n.unknownError;
        return reply({ ok: false, error: msg });
      }
    },
  };
}

// ─── pm-config Implementation ───

async function buildInitInstructions(
  projectDir: string,
  selectedLanguage?: string,
): Promise<string> {
  const config = loadConfig(projectDir);
  const packs = discoverLanguagePacks();

  if (selectedLanguage) {
    config.language = selectedLanguage;
    writeConfig(projectDir, config);
    const tpl = getControlPromptTemplate(selectedLanguage);
    return tpl.buildInitRemainingSteps(packs);
  }

  const tpl = getControlPromptTemplate(config.language);
  return tpl.buildInitInstructions(packs);
}

function createConfigTool(ctx: IPluginContext): ToolInfo {
  const cmdI18n = i18n().tool;
  const input: JsonSchema.JsonSchema = {
    type: 'object',
    properties: {
      subCommand: {
        type: 'string',
        description: 'Sub-command: view, edit, or init. Defaults to view.',
      },
      key: { type: 'string', description: 'Config key to edit (for edit sub-command)' },
      value: { type: 'string', description: 'JSON value to set (for edit sub-command)' },
      language: {
        type: 'string',
        description:
          'Selected interactive language locale (for init sub-command). DO NOT provide this parameter automatically — it must ONLY be set after user explicitly chooses a language via the question tool. When provided, init returns remaining steps in this language.',
      },
    },
  };

  return {
    name: 'pm_config',
    description: cmdI18n.commandDesc['pm-config'] ?? 'View or modify vibe-pm configuration',
    input,
    async execute(raw: unknown): Promise<ToolResult> {
      const sub = argString(raw, 'subCommand') ?? 'view';
      const key = argString(raw, 'key');
      const value = argString(raw, 'value');
      const language = argString(raw, 'language');

      if (!['view', 'edit', 'init', 'coding-style'].includes(sub)) {
        return { content: cmdI18n.unknownSubCommand(sub) };
      }

      try {
        if (sub === 'view') {
          const config = loadConfig(ctx.projectDir);
          return { content: JSON.stringify(config, null, 2) };
        }

        if (sub === 'edit') {
          if (!key) {
            return { content: cmdI18n.editNeedKey };
          }
          if (value === undefined) {
            return { content: cmdI18n.editNeedValue };
          }
          const config = loadConfig(ctx.projectDir);
          (config as unknown as Record<string, unknown>)[key] = JSON.parse(value);
          writeConfig(ctx.projectDir, config);
          return { content: cmdI18n.configUpdated(key, value) };
        }

        if (sub === 'init') {
          return { content: await buildInitInstructions(ctx.projectDir, language) };
        }

        if (sub === 'coding-style') {
          const config = loadConfig(ctx.projectDir);
          const languages = config.programmingLanguages ?? [];
          const docsDir = path.join(ctx.projectDir, 'docs');
          const regDir = path.join(docsDir, 'regulation');
          const installed = installCodingStyleFromTemplate(docsDir, regDir, languages);
          let response = cmdI18n.codingStyleInstalled(installed, regDir);
          if (config.language !== 'en-US' && installed.length > 0) {
            const tpl = getControlPromptTemplate(config.language);
            response += `\n\n${tpl.tool.translateMdFilePrompt}`;
            for (const f of installed) {
              response += `\n- Coding Style: ${f}`;
            }
          }
          return { content: response };
        }

        return { content: cmdI18n.unknownSubCommand(sub) };
      } catch (err) {
        const msg = err instanceof Error ? err.message : cmdI18n.unknownError;
        return { content: cmdI18n.operationFailed(msg) };
      }
    },
  };
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

interface InstallContext {
  config: PluginConfig;
  languages: string[];
  tpl: ReturnType<typeof getControlPromptTemplate>;
  /** Remember the detected project languages — called only after a successful install */
  persistLanguages: () => void;
}

/** Shared setup for both install modes (single template and batch). */
function resolveInstallContext(
  ctx: IPluginContext,
  programmingLanguages: string | undefined,
): InstallContext {
  const config = loadConfig(ctx.projectDir);
  const languages = resolveLanguages(programmingLanguages, config);

  return {
    config,
    languages,
    tpl: getControlPromptTemplate(config.language),
    persistLanguages: () => {
      if (languages.length > 0 && languages[0] !== 'General') {
        config.programmingLanguages = languages;
        writeConfig(ctx.projectDir, config);
      }
    },
  };
}

/** Non-en-US installations ask the model to translate the freshly written files. */
function buildTranslateSection(
  tpl: ReturnType<typeof getControlPromptTemplate>,
  flowPaths: string[],
  regulationPaths: string[],
  codingStylePaths: string[],
): string {
  let section = `\n\n${tpl.tool.translateMdFilePrompt}`;
  for (const fp of flowPaths) section += `\n- Flow: ${fp}`;
  for (const rp of regulationPaths) section += `\n- Regulation: ${rp}`;
  for (const cp of codingStylePaths) section += `\n- Coding Style: ${cp}`;

  const pluginTemplateDir = getPluginTemplateDir();
  if (pluginTemplateDir) {
    section += `\n- Dictionary template: ${path.join(pluginTemplateDir, 'dictionary-template.md')}`;
  }

  return section;
}

function createInstallFlowTool(ctx: IPluginContext): ToolInfo {
  const cmdI18n = i18n().tool;
  const input: JsonSchema.JsonSchema = {
    type: 'object',
    properties: {
      all: {
        type: 'boolean',
        description:
          'Set true to install ALL built-in flow templates at once (the user typed "/pm-install-flow all"). Mutually exclusive with templateId — when true, templateId is ignored. Never pass "all" as a templateId.',
      },
      templateId: {
        type: 'string',
        description:
          'Template ID to install (e.g. \'spec-driven-dev\', \'bug-fix\', \'research\', \'large-refactor\'). If omitted, lists available templates.',
      },
      programmingLanguages: {
        type: 'string',
        description:
          'Comma-separated programming language list, provided by LLM after analyzing project structure. Supports: TypeScript, Python, Go, Rust, Java, JavaScript, Kotlin, Ruby, Elixir, C/C++. e.g. \'TypeScript,Go\'. When omitted, reads from config cache; falls back to General.',
      },
      overwrite: {
        type: 'boolean',
        description:
          'Whether to overwrite existing flow docs (default false; prompts user to confirm when files exist).',
      },
    },
  };

  return {
    name: 'pm_install_flow',
    description: cmdI18n.commandDesc['pm-install-flow'] ?? 'Install a flow from template library',
    input,
    async execute(raw: unknown): Promise<ToolResult> {
      const all = argBoolean(raw, 'all') === true;
      const templateId = argString(raw, 'templateId');
      const programmingLanguages = argString(raw, 'programmingLanguages');
      const overwrite = argBoolean(raw, 'overwrite');

      if (all) {
        try {
          const { config, languages, tpl, persistLanguages } = resolveInstallContext(
            ctx,
            programmingLanguages,
          );

          const result = installAllTemplates(ctx.projectDir, {
            programmingLanguages: languages,
            overwrite,
            locale: config.language,
          });

          persistLanguages();

          if (result.installed.length + result.skipped.length + result.failed.length === 0) {
            return { content: cmdI18n.noTemplatesFound };
          }

          let response = tpl.tool.installAllSuccess(result);
          if (config.language !== 'en-US' && result.installed.length > 0) {
            response += buildTranslateSection(
              tpl,
              result.flowPaths,
              result.regulationPaths,
              result.codingStylePaths,
            );
          }
          return { content: response };
        } catch (err) {
          const msg = err instanceof Error ? err.message : cmdI18n.unknownError;
          const tpl = getControlPromptTemplate(loadConfig(ctx.projectDir).language);
          return { content: tpl.tool.installFailure(msg) };
        }
      }

      if (templateId) {
        try {
          const { config, languages, tpl, persistLanguages } = resolveInstallContext(
            ctx,
            programmingLanguages,
          );

          const result = installTemplate(ctx.projectDir, templateId, {
            programmingLanguages: languages,
            overwrite,
            locale: config.language,
          });

          persistLanguages();

          const needsTranslation = config.language !== 'en-US';
          let response = tpl.tool.installSuccess(templateId);

          if (needsTranslation && result.flowPath) {
            response += buildTranslateSection(
              tpl,
              [result.flowPath],
              result.regulationPaths,
              result.codingStylePaths,
            );
          }

          return { content: response };
        } catch (err) {
          const msg = err instanceof Error ? err.message : cmdI18n.unknownError;
          const tpl = getControlPromptTemplate(loadConfig(ctx.projectDir).language);
          return { content: tpl.tool.installFailure(msg) };
        }
      }

      const templates = scanTemplates(ctx.projectDir);
      if (templates.length === 0) {
        return { content: cmdI18n.noTemplatesFound };
      }

      const lines = templates.map(
        (t, i) =>
          `${i + 1}. \`${t.id}\` — ${t.name}（${t.description}）${
            t.command ? `→ \`${t.command}\`` : ''
          }`,
      );

      return { content: cmdI18n.templateList(lines.join('\n')) };
    },
  };
}

// ─── pm-uninstall-flow Implementation ───

function createUninstallFlowTool(ctx: IPluginContext): ToolInfo {
  const cmdI18n = i18n().tool;
  const input: JsonSchema.JsonSchema = {
    type: 'object',
    properties: {
      flowName: { type: 'string', description: 'Flow name to remove (e.g. spec-driven-dev)' },
    },
    required: ['flowName'],
  };

  return {
    name: 'pm_uninstall_flow',
    description:
      cmdI18n.commandDesc['pm-uninstall-flow'] ?? 'Remove an installed flow and its command',
    input,
    async execute(raw: unknown): Promise<ToolResult> {
      const flowName = argString(raw, 'flowName');
      if (!flowName) throw new Error('pm_uninstall_flow: flowName is required');

      try {
        uninstallFlow(ctx.projectDir, flowName);
        return { content: cmdI18n.uninstallSuccess(flowName) };
      } catch (err) {
        const msg = err instanceof Error ? err.message : cmdI18n.unknownError;
        return { content: cmdI18n.uninstallFailure(msg) };
      }
    },
  };
}

// ─── Flow Tool Registration ───

export function registerFlowTools(
  editor: ToolEditor,
  ctx: IPluginContext,
  engine: FlowEngine,
): void {
  const tools: ToolInfo[] = [];
  const flowDir = path.join(ctx.projectDir, 'docs', 'flow');
  if (!fs.existsSync(flowDir)) return;

  for (const file of fs.readdirSync(flowDir)) {
    if (!file.endsWith('.md')) continue;
    try {
      const flowName = file.replace(/^flow-/, '').replace(/\.md$/, '');
      logger.info(`registerFlowTools: found flow ${flowName}`);
      tools.push(createFlowStartTool(ctx, engine, flowName));
    } catch {
      // skip unparseable files
    }
  }

  for (const tool of tools) editor.add(tool);
  if (tools.length > 0) {
    logger.info(`registering flow tools: ${tools.map((t) => t.name)}`);
  }
}

/** Extract of the V2 transcript union that carries a flat user `text`. */
type UserMessageInfo = Extract<SessionMessageInfo, { type: 'user' }>;

function createFlowStartTool(
  ctx: IPluginContext,
  engine: FlowEngine,
  flowName: string,
): ToolInfo {
  const cmdI18n = i18n().tool;
  const input: JsonSchema.JsonSchema = {
    type: 'object',
    properties: {
      summary: { type: 'string', description: '任务摘要' },
      userRequest: {
        type: 'string',
        description: '用户原始请求全文 — 务必传递以保存任务上下文和去重',
      },
      deliverable: {
        type: 'string',
        description: '交付物重指定（覆盖流程文档默认交付物；可选）',
      },
      acceptanceStandard: {
        type: 'string',
        description: '交付标准重指定（覆盖流程文档默认交付标准；可选）',
      },
    },
  };

  return {
    name: `pm_${flowName.replace(/-/g, '_')}`,
    description: `Start a new task under the "${flowName}" flow. Call this tool BEFORE any analysis or implementation. Pass the user's original request as userRequest.`,
    input,
    async execute(raw: unknown, toolCtx: ToolContext): Promise<ToolResult> {
      const { sessionID, messageID } = toolCtx;
      const summary = argString(raw, 'summary') ?? '';
      const deliverable = argString(raw, 'deliverable');
      const acceptanceStandard = argString(raw, 'acceptanceStandard');

      if (!sessionID) {
        logger.warn(`createFlowStartTool(${flowName}): no sessionID`);
        return reply({ ok: false, error: cmdI18n.flowStartNoSession });
      }

      logger.info(
        `createFlowStartTool(${flowName}): sessionID=${sessionID} messageID=${messageID ?? 'N/A'} summary=${summary || 'N/A'} userRequest=${argString(raw, 'userRequest') ? 'provided' : 'extracting'}`,
      );

      // ── Extract userRequest ──
      let userRequest = argString(raw, 'userRequest') ?? '';

      // 1) Look up the triggering message by ID in the full transcript, else the latest user message
      if (!userRequest) {
        logger.info(
          `createFlowStartTool(${flowName}): trying session context via messageID=${messageID}`,
        );
        try {
          const messages = await ctx.session.context({ sessionID });
          const triggering = messages.find(
            (m): m is UserMessageInfo => m.type === 'user' && m.id === messageID,
          );
          const latestUser = [...messages]
            .reverse()
            .find((m): m is UserMessageInfo => m.type === 'user');
          const source = triggering ?? latestUser;
          if (source) {
            userRequest = source.text.trim();
            logger.info(
              `createFlowStartTool(${flowName}): extracted from session context, len=${userRequest.length}`,
            );
          }
        } catch (err) {
          logger.warn(`createFlowStartTool(${flowName}): session context fetch failed: ${err}`);
        }
      }

      // 2) Final fallback: use summary
      if (!userRequest && summary) {
        logger.info(`createFlowStartTool(${flowName}): fallback to summary as userRequest`);
        userRequest = summary;
      }

      logger.info(`createFlowStartTool(${flowName}): final userRequest len=${userRequest.length}`);

      try {
        const task = await engine.startTask({
          sessionId: sessionID,
          flow: flowName,
          summary,
          userRequest,
          deliverable,
          acceptanceStandard,
        });
        logger.info(
          `createFlowStartTool(${flowName}): task created id=${task.id} step=${task.currentStep}`,
        );
        return reply({
          ok: true,
          sessionId: task.sessionId,
          taskId: task.id,
          step: task.currentStep,
          stepName: task.currentStepName,
          flow: task.flow,
          summary: task.summary,
          startAt: task.startAt,
          deliverable: task.deliverable,
          acceptanceStandard: task.acceptanceStandard,
          notice:
            'S1: confirm the deliverables and acceptance standards with the user (use the values above if specified, otherwise the flow document defaults).',
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : cmdI18n.unknownError;
        logger.error(`createFlowStartTool(${flowName}): startTask failed: ${msg}`);
        return reply({ ok: false, error: msg });
      }
    },
  };
}

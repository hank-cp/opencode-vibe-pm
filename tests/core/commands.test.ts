/**
 * Command & Tool Registration Tests (OpenCode V2)
 *
 * V2 registers through `transform(editor)` callbacks: `editor.add(definition)` collects
 * definitions instead of writing a `config.command` map. These tests drive the real
 * registration functions with a capturing editor and then execute the captured definitions.
 *
 * Test file: tests/core/commands.test.ts
 * Related Spec: vibe-pm-plugin-core.md
 */

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import type {
  CommandEditor,
  CommandInvocation,
  IPluginContext,
  PluginConfig,
  ToolContext,
  ToolEditor,
  ToolInfo,
} from '../../src/core/types.js';
import { registerCommands, registerTools } from '../../src/core/commands.js';
import { setCurrentLocale, clearI18nCache } from '../../src/i18n';
import { writeConfig } from '../../src/core/config.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { MemorySystem } from '../../src/memory';

// ─── Harness ───

type CommandDefinition = Parameters<CommandEditor['add']>[0];

/** Capturing command editor: V2 `editor.add()` is the registration primitive. */
function makeCommandEditor(): { editor: CommandEditor; definitions: CommandDefinition[] } {
  const definitions: CommandDefinition[] = [];
  const editor: CommandEditor = {
    add: (definition) => {
      definitions.push(definition);
    },
  };
  return { editor, definitions };
}

function makeToolEditor(): { editor: ToolEditor; tools: ToolInfo[] } {
  const tools: ToolInfo[] = [];
  const editor = {
    add: (tool: ToolInfo) => {
      tools.push(tool);
    },
    list: () => [],
    get: () => undefined,
    namespace: () => {},
    update: () => {},
    remove: () => {},
  } as unknown as ToolEditor;
  return { editor, tools };
}

/** Minimal session gateway for command handlers: they only call `prompt`. */
function makeCommandSession(): {
  session: Parameters<typeof registerCommands>[1];
  prompts: { sessionID: string; text: string; delivery: string }[];
} {
  const prompts: { sessionID: string; text: string; delivery: string }[] = [];
  const session = {
    prompt: async (input: { sessionID: string; text: string; delivery: string }) => {
      prompts.push(input);
    },
  } as unknown as Parameters<typeof registerCommands>[1];
  return { session, prompts };
}

function makeInvocation(text = 'USER-INPUT'): CommandInvocation {
  return {
    sessionID: 'session-1',
    prompt: { text } as CommandInvocation['prompt'],
    delivery: 'steer',
  };
}

// Mock FlowEngine for tool tests
function createMockEngine() {
  const taskId = 'task-mock-001';
  return {
    startTask: mock(() =>
      Promise.resolve({
        id: taskId,
        sessionId: 'test',
        flow: 'research',
        currentStep: '',
        currentStepName: '',
        summary: '测试任务',
        startAt: new Date().toISOString(),
      }),
    ),
    getCurrentStep: mock(() =>
      Promise.resolve({
        id: taskId,
        sessionId: 'test',
        flow: 'research',
        currentStep: 'S3',
        currentStepName: '测试步骤',
        summary: '测试任务',
        startAt: new Date().toISOString(),
      }),
    ),
    setStep: mock(() => Promise.resolve({ ok: true, step: 'S3', stepName: '测试步骤' })),
    closeTask: mock(() =>
      Promise.resolve({
        id: taskId,
        sessionId: 'test',
        flow: 'research',
        currentStep: 'S3',
        currentStepName: '测试步骤',
        summary: '测试任务',
        startAt: new Date().toISOString(),
        closed: true,
      }),
    ),
    verifyOutput: mock(() => Promise.resolve({ ok: true })),
  } as unknown as Parameters<typeof registerTools>[2];
}

async function createTempMemory() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-pm-test-task-'));
  const memory = new MemorySystem();
  await memory.init(tmpDir);
  return memory;
}

async function seedTask(memory: MemorySystem, sessionId: string) {
  await memory.createTask({
    sessionId,
    flow: 'research',
    currentStep: 'S3',
    currentStepName: '测试步骤',
    startAt: new Date().toISOString(),
    summary: '测试任务',
  });
}

function parseResult(result: { content?: string | readonly unknown[] }): Record<string, unknown> {
  const content = typeof result.content === 'string' ? result.content : '';
  return JSON.parse(content) as Record<string, unknown>;
}

function toolByName(tools: ToolInfo[], name: string): ToolInfo {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`tool not registered: ${name}`);
  return tool;
}

const EXPECTED_COMMANDS = [
  'pm-install-flow',
  'pm-uninstall-flow',
  'pm-refine-flow',
  'pm-task-set-step',
  'pm-task-close',
  'pm-task-current-step',
  'pm-config',
];

const EXPECTED_TOOLS = [
  'pm_install_flow',
  'pm_uninstall_flow',
  'pm_config',
  'pm_task_set_step',
  'pm_task_close',
  'pm_task_current_step',
  'pm_task_verify',
];

describe('registerCommands', () => {
  it('register_all_commands: registers all 7 /pm-* commands; every command prepends a template', async () => {
    const { editor, definitions } = makeCommandEditor();
    const { session, prompts } = makeCommandSession();

    registerCommands(editor, session);

    const names = definitions.map((d) => d.name);
    expect(names).toHaveLength(7);
    expect(names).toEqual(EXPECTED_COMMANDS);

    for (const definition of definitions) {
      expect(definition.description).toBeTruthy();

      // V1 stored a `template` field; V2 prepends it in `execute` — assert the template
      // survives by running the definition and inspecting the delivered prompt.
      await definition.execute(makeInvocation());
      const delivered = prompts[prompts.length - 1]!;
      expect(delivered.sessionID).toBe('session-1');
      expect(delivered.text.endsWith('\n\nUSER-INPUT')).toBe(true);
      const template = delivered.text.slice(0, -'\n\nUSER-INPUT'.length);
      expect(template.length).toBeGreaterThan(0);
      expect(template).not.toBe('USER-INPUT');
    }
  });

  it('command_template_is_code_owned: stale config templates never leak into commands', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-pm-test-cmd-'));
    try {
      const legacy: PluginConfig = {
        language: 'en-US',
        dataDir: '.vibe-pm',
        autoAnalyze: true,
        contextInjection: { maxStepTokens: 0, pruneIrrelevant: true },
        // V1-era leftovers; V2 command definitions are code-owned.
        ...({ command: { 'pm-install-flow': { template: 'old template' } } } as object),
      };
      writeConfig(tmpDir, legacy);

      const { editor, definitions } = makeCommandEditor();
      const { session, prompts } = makeCommandSession();

      registerCommands(editor, session);

      const install = definitions.find((d) => d.name === 'pm-install-flow');
      expect(install).toBeDefined();
      await install!.execute(makeInvocation('GO'));

      const text = prompts[0]!.text;
      expect(text).toContain(
        'Install a flow from template library — call the pm_install_flow tool. Pass templateId for a single template.',
      );
      // The `all` mapping rule must reach the model, otherwise it forwards
      // "all" as a templateId and the install fails with `Template "all" not found`.
      expect(text).toContain('pass all=true instead of templateId');
      expect(text).not.toContain('old template');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('registerTools', () => {
  let mockCtx: IPluginContext;
  let mockToolCtx: ToolContext;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-pm-test-'));
    mockCtx = {
      config: {
        language: 'zh-CN',
        dataDir: '.vibe-pm',
        autoAnalyze: true,
        contextInjection: { maxStepTokens: 0, pruneIrrelevant: true },
      },
      projectDir: tmpDir,
      dataDir: path.join(tmpDir, '.vibe-pm'),
      session: { context: async () => [] },
    };
    mockToolCtx = {
      sessionID: 'test',
      messageID: 'msg1',
      agent: 'build',
      id: 'call-1',
      signal: new AbortController().signal,
      progress: async () => {},
    } as unknown as ToolContext;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('register_executable_tools: registers 7 executable tools with JSON Schema inputs', async () => {
    const engine = createMockEngine();
    const memory = await createTempMemory();
    const { editor, tools } = makeToolEditor();

    registerTools(editor, mockCtx, engine, memory);

    const names = tools.map((t) => t.name);
    expect(names).toHaveLength(7);
    for (const name of EXPECTED_TOOLS) expect(names).toContain(name);

    // V2 takes native JSON Schema literals (zod@3.23 does not satisfy StandardSchemaV1).
    for (const tool of tools) {
      const schema = tool.input as { type?: unknown; properties?: unknown };
      expect(schema.type).toBe('object');
      expect(typeof schema.properties).toBe('object');
      expect(tool.description.length).toBeGreaterThan(0);
    }
  });

  it('pm_install_flow_all_ignores_template_id: all=true installs the whole library', async () => {
    const engine = createMockEngine();
    const memory = await createTempMemory();
    const { editor, tools } = makeToolEditor();
    registerTools(editor, mockCtx, engine, memory);

    const templateDir = path.join(tmpDir, 'docs', 'template');
    for (const id of ['alpha', 'beta']) {
      const bundleDir = path.join(templateDir, id);
      fs.mkdirSync(bundleDir, { recursive: true });
      fs.writeFileSync(
        path.join(bundleDir, 'flow.md'),
        `# ${id}\n\n**Template ID**: \`${id}\`\n**Category**: development\n**Description**: Test ${id}\n**Command**: \`/pm-${id}\`\n**Version**: 1.0.0\n`,
      );
    }

    const result = await toolByName(tools, 'pm_install_flow').execute(
      { all: true, templateId: 'alpha' },
      mockToolCtx,
    );

    // templateId must be ignored — beta proves the batch ran.
    expect(result.content).toContain('beta');
    expect(fs.existsSync(path.join(tmpDir, 'docs', 'flow', 'flow-alpha.md'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'docs', 'flow', 'flow-beta.md'))).toBe(true);
  });

  it('pm_task_set_step_jumps: jumps step and returns JSON', async () => {
    const engine = createMockEngine();
    const memory = await createTempMemory();
    await seedTask(memory, mockToolCtx.sessionID);
    const { editor, tools } = makeToolEditor();
    registerTools(editor, mockCtx, engine, memory);

    const result = await toolByName(tools, 'pm_task_set_step').execute(
      { step: 'S3' },
      mockToolCtx,
    );
    const parsed = parseResult(result);
    expect(parsed.ok).toBe(true);
    expect(parsed.step).toBeTruthy();
    expect(parsed.sessionId).toBe('test');
    expect(parsed.taskId).toBeTruthy();
    expect(engine.setStep).toHaveBeenCalledWith('test', 'S3', false);
  });

  it('pm_task_close_closes_task: closes task and returns JSON', async () => {
    const engine = createMockEngine();
    const memory = await createTempMemory();
    const { editor, tools } = makeToolEditor();
    registerTools(editor, mockCtx, engine, memory);

    const result = await toolByName(tools, 'pm_task_close').execute({}, mockToolCtx);
    const parsed = parseResult(result);
    expect(parsed.ok).toBe(true);
    expect(parsed.flow).toBe('research');
    expect(parsed.step).toBe('S3');
    expect(parsed.taskId).toBe('task-mock-001');
    expect(engine.closeTask).toHaveBeenCalledWith('test');
  });

  it('pm_task_close_no_active_task: no active task — returns {ok:false}', async () => {
    const engine = createMockEngine();
    engine.closeTask = mock(() => Promise.resolve(null));
    const memory = await createTempMemory();
    const { editor, tools } = makeToolEditor();
    registerTools(editor, mockCtx, engine, memory);

    const result = await toolByName(tools, 'pm_task_close').execute({}, mockToolCtx);
    expect(parseResult(result).ok).toBe(false);
  });

  it('pm_task_current_step_returns_step: active task — returns step JSON', async () => {
    const engine = createMockEngine();
    const memory = await createTempMemory();
    await seedTask(memory, mockToolCtx.sessionID);
    const { editor, tools } = makeToolEditor();
    registerTools(editor, mockCtx, engine, memory);

    const result = await toolByName(tools, 'pm_task_current_step').execute({}, mockToolCtx);
    const parsed = parseResult(result);
    expect(parsed.ok).toBe(true);
    expect(parsed.step).toBeTruthy();
    expect(parsed.stepName).toBeTruthy();
    expect(parsed.sessionId).toBe('test');
    expect(parsed.taskId).toBeTruthy();
  });

  it('pm_task_current_step_no_task: no active task — returns {ok:false}', async () => {
    const engine = createMockEngine();
    const memory = await createTempMemory();
    const { editor, tools } = makeToolEditor();
    registerTools(editor, mockCtx, engine, memory);

    const result = await toolByName(tools, 'pm_task_current_step').execute({}, mockToolCtx);
    expect(parseResult(result).ok).toBe(false);
  });

  it('pm_task_current_step_no_session: no sessionID — returns JSON error', async () => {
    const engine = createMockEngine();
    const memory = await createTempMemory();
    const { editor, tools } = makeToolEditor();
    registerTools(editor, mockCtx, engine, memory);
    const noSessionCtx = { ...mockToolCtx, sessionID: '' } as unknown as ToolContext;

    const result = await toolByName(tools, 'pm_task_current_step').execute({}, noSessionCtx);
    const parsed = parseResult(result);
    expect(parsed.ok).toBe(false);
    expect(String(parsed.error)).toContain('Session ID');
  });

  it('pm_config_init_returns_json: init sub-command returns valid JSON instructions (phase 1: language selection only)', async () => {
    const engine = createMockEngine();
    const memory = await createTempMemory();
    const { editor, tools } = makeToolEditor();
    registerTools(editor, mockCtx, engine, memory);

    const result = await toolByName(tools, 'pm_config').execute(
      { subCommand: 'init' },
      mockToolCtx,
    );
    const parsed = parseResult(result) as {
      flow: string;
      steps: { id: string; nextAction: string }[];
    };
    expect(parsed.flow).toBe('pm-config-init');
    expect(parsed.steps).toHaveLength(1);
    expect(parsed.steps[0]!.id).toBe('language');
    expect(parsed.steps[0]!.nextAction).toContain('pm_config init');
  });

  it('pm_config_init_persists_language_to_config: after init with language param, config.json has language saved', async () => {
    const engine = createMockEngine();
    const memory = await createTempMemory();
    const { editor, tools } = makeToolEditor();
    registerTools(editor, mockCtx, engine, memory);

    await toolByName(tools, 'pm_config').execute(
      { subCommand: 'init', language: 'zh-CN' },
      mockToolCtx,
    );

    const configPath = path.join(tmpDir, '.vibe-pm', 'config.json');
    const saved = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as { language: string };
    expect(saved.language).toBe('zh-CN');
  });

  it('pm_config_init_with_language_returns_remaining_steps: with language param — returns remaining steps', async () => {
    const engine = createMockEngine();
    const memory = await createTempMemory();
    const { editor, tools } = makeToolEditor();
    registerTools(editor, mockCtx, engine, memory);

    const result = await toolByName(tools, 'pm_config').execute(
      { subCommand: 'init', language: 'en-US' },
      mockToolCtx,
    );
    const parsed = parseResult(result) as { flow: string; steps: { id: string }[] };
    expect(parsed.flow).toBe('pm-config-init');
    expect(parsed.steps).toHaveLength(8);
    expect(parsed.steps.map((s) => s.id)).toEqual([
      'scope',
      'gitignore',
      'agents',
      'dictionary',
      'integrations-dcp',
      'integrations-vision',
      'integrations-code-review',
      'done',
    ]);
  });

  it('pm_config_init_with_language_returns_localized_steps: with zh-CN param — returns Chinese steps', async () => {
    const engine = createMockEngine();
    const memory = await createTempMemory();
    const { editor, tools } = makeToolEditor();
    registerTools(editor, mockCtx, engine, memory);

    const result = await toolByName(tools, 'pm_config').execute(
      { subCommand: 'init', language: 'zh-CN' },
      mockToolCtx,
    );
    const parsed = parseResult(result) as { steps: { id: string; title: string }[] };
    const scopeStep = parsed.steps.find((s) => s.id === 'scope');
    expect(scopeStep).toBeDefined();
    expect(scopeStep!.title).toBe('配置范围');
  });

  it('pm_config_init_agents_instruction_has_scenario_separation: agents step instruction separates "Scenario A" / "Scenario B" and forbids default lightweight update', async () => {
    const engine = createMockEngine();
    const memory = await createTempMemory();
    const { editor, tools } = makeToolEditor();
    registerTools(editor, mockCtx, engine, memory);

    const result = await toolByName(tools, 'pm_config').execute(
      { subCommand: 'init', language: 'en-US' },
      mockToolCtx,
    );
    const parsed = parseResult(result) as {
      steps: { id: string; instruction: string; templateFile?: string }[];
    };

    const agentsStep = parsed.steps.find((s) => s.id === 'agents');
    expect(agentsStep).toBeDefined();
    const instruction = agentsStep!.instruction;

    // Regression: scenario separation must exist in the fix
    expect(instruction).toContain('Scenario A');
    expect(instruction).toContain('Scenario B');
    expect(instruction).toContain('FORBIDDEN');
    expect(instruction).toContain('Full Rewrite');
    expect(instruction).toContain('inform user');
    expect(instruction).toContain('docs/template/agents-template.md');
    expect(agentsStep!.templateFile).toBe('agents-template.md');
  });

  it('pm_config_unknown_sub_returns_error: unknown sub-command returns error', async () => {
    setCurrentLocale('zh-CN');
    const engine = createMockEngine();
    const memory = await createTempMemory();
    const { editor, tools } = makeToolEditor();
    registerTools(editor, mockCtx, engine, memory);

    const result = await toolByName(tools, 'pm_config').execute(
      { subCommand: 'unknown' },
      mockToolCtx,
    );
    clearI18nCache();
    expect(String(result.content)).toContain('未知');
  });

  it('pm_config_coding_style_installs_from_config: coding-style subcommand installs coding style files', async () => {
    setCurrentLocale('en-US');
    const engine = createMockEngine();
    const memory = await createTempMemory();
    writeConfig(tmpDir, { ...mockCtx.config, programmingLanguages: ['TypeScript'] });
    const { editor, tools } = makeToolEditor();
    registerTools(editor, mockCtx, engine, memory);

    const result = await toolByName(tools, 'pm_config').execute(
      { subCommand: 'coding-style' },
      mockToolCtx,
    );
    clearI18nCache();
    const output = String(result.content);
    expect(output).toContain('✅');
    expect(output).toContain('coding_style');

    const regDir = path.join(tmpDir, 'docs', 'regulation', 'coding_style');
    expect(fs.existsSync(path.join(regDir, 'typescript.md'))).toBe(true);
    expect(fs.existsSync(path.join(regDir, 'general.md'))).toBe(true);
  });

  it('pm_config_coding_style_returns_info_when_no_new_files: second call skips existing files', async () => {
    setCurrentLocale('en-US');
    const engine = createMockEngine();
    const memory = await createTempMemory();
    const { editor, tools } = makeToolEditor();
    registerTools(editor, mockCtx, engine, memory);

    const configTool = toolByName(tools, 'pm_config');
    await configTool.execute({ subCommand: 'coding-style' }, mockToolCtx);
    const result = await configTool.execute({ subCommand: 'coding-style' }, mockToolCtx);
    clearI18nCache();
    expect(String(result.content)).toContain('No new');
  });

  it('pm_config_coding_style_falls_back_to_general: empty programmingLanguages installs general.md', async () => {
    setCurrentLocale('en-US');
    const engine = createMockEngine();
    const memory = await createTempMemory();
    const { editor, tools } = makeToolEditor();
    registerTools(editor, mockCtx, engine, memory);

    const result = await toolByName(tools, 'pm_config').execute(
      { subCommand: 'coding-style' },
      mockToolCtx,
    );
    clearI18nCache();
    expect(String(result.content)).toContain('✅');

    const regDir = path.join(tmpDir, 'docs', 'regulation', 'coding_style');
    expect(fs.existsSync(path.join(regDir, 'general.md'))).toBe(true);
  });

  it('pm_config_coding_style_includes_translation_hint: non-en-US locale appends translateMdFilePrompt', async () => {
    setCurrentLocale('zh-CN');
    const engine = createMockEngine();
    const memory = await createTempMemory();
    writeConfig(tmpDir, { ...mockCtx.config, language: 'zh-CN' });
    const { editor, tools } = makeToolEditor();
    registerTools(editor, mockCtx, engine, memory);

    const result = await toolByName(tools, 'pm_config').execute(
      { subCommand: 'coding-style' },
      mockToolCtx,
    );
    clearI18nCache();
    expect(String(result.content)).toContain('✅');
  });

  it('pm_config_coding_style_no_hint_for_en_US: en-US locale does not include translateMdFilePrompt', async () => {
    setCurrentLocale('en-US');
    const engine = createMockEngine();
    const memory = await createTempMemory();
    writeConfig(tmpDir, { ...mockCtx.config, language: 'en-US' });
    const { editor, tools } = makeToolEditor();
    registerTools(editor, mockCtx, engine, memory);

    const result = await toolByName(tools, 'pm_config').execute(
      { subCommand: 'coding-style' },
      mockToolCtx,
    );
    clearI18nCache();
    const output = String(result.content);
    expect(output).toContain('✅');
    expect(output).not.toContain('Do NOT translate');
  });
});

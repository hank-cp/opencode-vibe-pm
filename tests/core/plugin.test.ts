/**
 * Plugin Entry Tests (OpenCode V2)
 *
 * V2 (`Plugin.define({ id, setup })`) has no returned hook map: `setup(ctx)` registers
 * everything through domain transforms and returns a cleanup. These tests build a minimal
 * V2 context, run the real `setup`, and assert both the registrations and the context-hook
 * behaviour (flow prompt injection / stale prompt removal).
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { Context as PluginContext } from '@opencode/plugin/promise/plugin';
import type { CommandDefinition } from '@opencode/plugin/promise/command';
import type { SessionContext } from '@opencode/plugin/promise/session';
import type { SessionMessageInfo } from '@opencode/client';
import type { AIMessage, AIContentPart, ToolContext, ToolInfo } from '../../src/core/types.js';
import { VibePMPlugin } from '../../src/core/plugin.js';

// ─── Minimal V2 context ───

interface Harness {
  commands: CommandDefinition[];
  tools: ToolInfo[];
  subscribeCalls: number;
  invokeContext(event: SessionContext): Promise<void>;
}

function makeMessage(role: AIMessage['role'], content: AIContentPart[]): AIMessage {
  return { role, content } as AIMessage;
}

function makeToolContext(sessionID: string, messageID = 'msg-1'): ToolContext {
  return {
    sessionID,
    messageID,
    agent: 'build',
    id: 'call-1',
    signal: new AbortController().signal,
    progress: async () => {},
  } as unknown as ToolContext;
}

function makeCtx(directory: string): { ctx: PluginContext; harness: Harness } {
  const commands: CommandDefinition[] = [];
  const tools: ToolInfo[] = [];
  let contextHook: ((event: SessionContext) => Promise<void>) | undefined;
  let subscribeCalls = 0;

  const harness: Harness = {
    commands,
    tools,
    get subscribeCalls() {
      return subscribeCalls;
    },
    async invokeContext(event: SessionContext): Promise<void> {
      if (!contextHook) throw new Error('context hook was not registered');
      await contextHook(event);
    },
  };

  const session = {
    get: async (input: { sessionID: string }) => ({ id: input.sessionID }),
    create: async (input: { parentID?: string; title?: string }) => ({
      id: `child-${input.parentID ?? 'root'}`,
    }),
    prompt: async () => ({}),
    wait: async () => {},
    context: async () => [] as SessionMessageInfo[],
    hook: async (name: string, callback: (event: SessionContext) => Promise<void>) => {
      if (name === 'context') contextHook = callback;
      return { dispose: async () => {} };
    },
  };

  const registration = { dispose: async () => {} };

  const ctx = {
    app: { name: 'opencode', version: '2.1.1', channel: 'dev' },
    location: { directory },
    options: {},
    session,
    command: {
      transform: async (callback: (editor: { add(d: CommandDefinition): void }) => void) => {
        callback({ add: (definition) => commands.push(definition) });
        return registration;
      },
    },
    tool: {
      transform: async (callback: (editor: { add(t: ToolInfo): void }) => void) => {
        callback({ add: (tool) => tools.push(tool) });
        return registration;
      },
    },
    event: {
      subscribe: () => {
        subscribeCalls += 1;
        return {
          async *[Symbol.asyncIterator]() {
            // No events: the subscription must not keep the test alive.
          },
        };
      },
    },
  } as unknown as PluginContext;

  return { ctx, harness };
}

function toolByName(tools: ToolInfo[], name: string): ToolInfo {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`tool not registered: ${name}`);
  return tool;
}

function emptySession(tools: Record<string, unknown> = {}): SessionContext {
  return {
    sessionID: 's1',
    agent: 'build',
    model: { id: 'test-model', providerID: 'test' },
    system: [],
    messages: [],
    tools,
    options: {},
  } as unknown as SessionContext;
}

function userEvent(
  sessionID: string,
  parts: AIContentPart[],
  tools: Record<string, unknown> = {},
): SessionContext {
  return {
    ...emptySession(tools),
    sessionID,
    messages: [makeMessage('user', parts)],
  } as SessionContext;
}

describe('VibePMPlugin', () => {
  let tmpDir: string;
  let harness: Harness;
  let cleanup: void | (() => void | Promise<void>);

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-pm-test-'));
    fs.mkdirSync(path.join(tmpDir, 'docs', 'flow'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'docs', 'flow', 'test-flow.md'),
      '**Command**: `/pm-test`\n# Test Flow\n\n## S1\n\n**完成后**: S2\n\n## S2\n\n**完成后**: [*]\n',
    );
    const made = makeCtx(tmpDir);
    harness = made.harness;
    cleanup = await VibePMPlugin.setup(made.ctx);
  });

  afterAll(async () => {
    if (typeof cleanup === 'function') await cleanup();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('registers commands, tools, context hook and event subscription', () => {
    const names = harness.commands.map((c) => c.name);
    expect(names).toHaveLength(8);
    for (const name of [
      'pm-install-flow',
      'pm-uninstall-flow',
      'pm-refine-flow',
      'pm-task-set-step',
      'pm-task-close',
      'pm-task-current-step',
      'pm-config',
      'pm-test',
    ]) {
      expect(names).toContain(name);
    }

    const toolNames = harness.tools.map((t) => t.name);
    for (const name of [
      'pm_install_flow',
      'pm_uninstall_flow',
      'pm_config',
      'pm_task_set_step',
      'pm_task_close',
      'pm_task_current_step',
      'pm_task_verify',
      'pm_test_flow',
    ]) {
      expect(toolNames).toContain(name);
    }

    // `setup` returns the cleanup that aborts the event subscription.
    expect(typeof harness.subscribeCalls).toBe('number');
    expect(harness.subscribeCalls).toBe(1);
    expect(typeof cleanup).toBe('function');
  });

  it('injects protect when active task exists', async () => {
    const flowTool = toolByName(harness.tools, 'pm_test_flow');
    const created = await flowTool.execute(
      { summary: 'test task', userRequest: '/pm-test start\n' },
      makeToolContext('s1'),
    );
    expect(JSON.parse(String(created.content)).ok).toBe(true);

    const event = userEvent('s1', [
      { type: 'text', text: '<auto-slash-command>\n/pm-test start\n</auto-slash-command>' },
    ]);
    await harness.invokeContext(event);

    const content = event.messages[0]!.content as AIContentPart[];
    expect(content).toHaveLength(2);

    const injected = content[1]!;
    expect(injected.type).toBe('text');
    if (injected.type !== 'text') throw new Error('expected an injected text part');
    expect(injected.text).toContain('<protect>');
    expect(injected.metadata?.['synthetic']).toBe(true);

    const closeTool = toolByName(harness.tools, 'pm_task_close');
    await closeTool.execute({}, makeToolContext('s1'));
  });

  it('does not inject without an active task', async () => {
    const event = userEvent('s2', [{ type: 'text', text: 'hello' }]);
    await harness.invokeContext(event);

    const content = event.messages[0]!.content as AIContentPart[];
    expect(content).toHaveLength(1);
  });

  it('appends the control prompt when the task exists but no slash command was expanded', async () => {
    const flowTool = toolByName(harness.tools, 'pm_test_flow');
    const created = await flowTool.execute(
      { summary: 'no marker', userRequest: 'plain request\n' },
      makeToolContext('s4'),
    );
    expect(JSON.parse(String(created.content)).ok).toBe(true);

    const event = userEvent('s4', [{ type: 'text', text: 'plain request' }]);
    await harness.invokeContext(event);

    const content = event.messages[0]!.content as AIContentPart[];
    expect(content).toHaveLength(2);
    const injected = content[1]!;
    if (injected.type !== 'text') throw new Error('expected an injected text part');
    expect(injected.text).toContain('<protect>');

    const closeTool = toolByName(harness.tools, 'pm_task_close');
    await closeTool.execute({}, makeToolContext('s4'));
  });

  it('clears stale control prompt when no active task', async () => {
    const event = userEvent('s3', [
      { type: 'text', text: 'hello' },
      { type: 'text', text: '<protect>\nold\n</protect>' },
    ]);
    await harness.invokeContext(event);

    const content = event.messages[0]!.content as AIContentPart[];
    expect(content).toHaveLength(1);
  });

  it('injects_protect_when_active_task_exists: injects protect only once per message', async () => {
    const flowTool = toolByName(harness.tools, 'pm_test_flow');
    const created = await flowTool.execute(
      { summary: 'dedup test', userRequest: '/pm-test dedup\n' },
      makeToolContext('sd', 'msg-d'),
    );
    expect(JSON.parse(String(created.content)).ok).toBe(true);

    const cmd = '<auto-slash-command>\n/pm-test dedup\n</auto-slash-command>';

    const first = userEvent('sd', [{ type: 'text', text: cmd }]);
    await harness.invokeContext(first);
    expect((first.messages[0]!.content as AIContentPart[]).length).toBe(2);

    const second = userEvent('sd', [{ type: 'text', text: cmd }]);
    await harness.invokeContext(second);
    expect((second.messages[0]!.content as AIContentPart[]).length).toBe(2);

    const closeTool = toolByName(harness.tools, 'pm_task_close');
    await closeTool.execute({}, makeToolContext('sd', 'msg-d'));
  });
});

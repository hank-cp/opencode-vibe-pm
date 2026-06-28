/**
 * Task Start Tests
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { MemorySystem } from '../../src/memory/memory-system.js';
import { FlowEngine } from '../../src/engine/flow-engine.js';
import { FlowNotFoundError } from '../../src/engine/errors.js';
import type { PluginConfig } from '../../src/core/types.js';

const _DEFAULT_CONFIG: PluginConfig = {
  language: 'zh-CN',
  dataDir: '.vibe-pm',
  autoAnalyze: true,
  contextInjection: { maxStepTokens: 0, pruneIrrelevant: false },
};

function createTestProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-pm-test-ts-'));
  fs.mkdirSync(path.join(dir, 'docs', 'flow'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'docs', 'regulation'), { recursive: true });
  fs.copyFileSync(
    path.join(process.cwd(), 'docs', 'flow', 'test-flow.md'),
    path.join(dir, 'docs', 'flow', 'test-flow.md')
  );
  fs.copyFileSync(
    path.join(process.cwd(), 'docs', 'regulation', 'constitution.md'),
    path.join(dir, 'docs', 'regulation', 'constitution.md')
  );
  return dir;
}

describe('Task Start', () => {
  let tmpDir: string;
  let memory: MemorySystem;
  let engine: FlowEngine;

  beforeAll(async () => {
    tmpDir = createTestProject();
    memory = new MemorySystem();
    await memory.init(path.join(tmpDir, '.vibe-pm'));
    engine = new FlowEngine(memory, tmpDir);
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('start_task_creates_successfully: creates task normally', async () => {
    const task = await engine.startTask({
      sessionId: 'ses_new',
      flow: 'test-flow',
      summary: 'Test task creation',
      userRequest: 'test',
    });

    expect(task.sessionId).toBe('ses_new');
    expect(task.flow).toBe('test-flow');
    expect(task.currentStep).toBe('');
    expect(task.currentStepName).toBe('');
    expect(task.closed).toBe(false);
    expect(task.summary).toBe('Test task creation');
  });

  it('start_task_rejects_duplicate: rejects duplicate active task', async () => {
    await engine.startTask({
      sessionId: 'ses_dup',
      flow: 'test-flow',
      summary: 'First task',
      userRequest: 'dup test',
    });

    await expect(
      engine.startTask({
        sessionId: 'ses_dup',
        flow: 'test-flow',
        summary: 'Second task',
        userRequest: 'dup test 2',
      })
    ).rejects.toThrow('already has active task');
  });

  it('start_task_rejects_missing_flow: throws for nonexistent Flow', async () => {
    await expect(
      engine.startTask({
        sessionId: 'ses_missing',
        flow: 'nonexistent',
        summary: 'test',
        userRequest: 'test',
      })
    ).rejects.toThrow(FlowNotFoundError);
  });

  it('resolve_flow_from_command: resolves command to flow name', async () => {
    const flowName = engine.resolveFlowFromCommand('pm-test');
    expect(flowName).toBe('test-flow');
  });

  it('resolve_flow_from_command_with_slash: resolves command with / prefix', () => {
    const flowName = engine.resolveFlowFromCommand('/pm-test');
    expect(flowName).toBe('test-flow');
  });

  it('resolve_unknown_command: returns null for unknown command', () => {
    expect(engine.resolveFlowFromCommand('pm-unknown')).toBeNull();
  });

  it('resolve_unknown_command_with_slash: returns null for unknown command with / prefix', () => {
    expect(engine.resolveFlowFromCommand('/pm-unknown')).toBeNull();
  });

  it('closeTask_after_reinstantiation: closeTask works after re-instantiation', async () => {
    const engine2 = new FlowEngine(memory, tmpDir);
    await engine2.startTask({
      sessionId: 'ses_res_close',
      flow: 'test-flow',
      summary: 'restart close test',
      userRequest: 'restart close test',
    });
    const closed = await engine2.closeTask('ses_res_close');
    expect(closed).not.toBeNull();
    expect(closed!.closed).toBe(true);
    expect(closed!.flow).toBe('test-flow');
  });

  it('setStep_after_reinstantiation: setStep works after re-instantiation', async () => {
    const engine2 = new FlowEngine(memory, tmpDir);
    await engine2.startTask({
      sessionId: 'ses_res_step',
      flow: 'test-flow',
      summary: 'restart step test',
      userRequest: 'restart step test',
    });
    await engine2.setStep('ses_res_step', 'S2');
    const engine3 = new FlowEngine(memory, tmpDir);
    await engine3.setStep('ses_res_step', 'S3');
    const updated = await memory.getActiveTask('ses_res_step');
    expect(updated!.currentStep).toBe('S3');
    expect(updated!.stepTransitions).toHaveLength(2);
  });
});

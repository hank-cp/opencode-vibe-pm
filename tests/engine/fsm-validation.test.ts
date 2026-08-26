/**
 * FSM Validation Tests
 *
 * End-to-end behavior of FlowEngine.setStep with FSM transition validation:
 * legal transitions, illegal transitions (warn + unchanged), first-entry
 * validation, legacy 0.1 freedom, and degradation fallback.
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { MemorySystem } from '../../src/memory/memory-system.js';
import { FlowEngine } from '../../src/engine/flow-engine.js';

const FIXTURES = path.join(import.meta.dirname, 'fixtures');

const V2_FULL = 'v2-full';
const V1_LEGACY = 'v1-legacy';
const V2_NO_FSM = 'v2-no-fsm';
const V2_BAD_FSM = 'v2-bad-fsm';

function createTestProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-pm-fsm-'));
  const flowDir = path.join(dir, 'docs', 'flow');
  fs.mkdirSync(flowDir, { recursive: true });
  for (const name of [V2_FULL, V1_LEGACY, V2_NO_FSM, V2_BAD_FSM]) {
    fs.copyFileSync(
      path.join(FIXTURES, `flow-${name}.md`),
      path.join(flowDir, `flow-${name}.md`),
    );
  }
  return dir;
}

async function startTask(engine: FlowEngine, sessionId: string, flow: string) {
  return engine.startTask({
    sessionId,
    flow,
    summary: `fsm test ${flow}`,
    userRequest: `fsm validation test for ${flow}`,
  });
}

describe('FSM Validation: V2 flow', () => {
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

  it('allows first entry into an FSM start step', async () => {
    await startTask(engine, 'ses_v2_entry_ok', V2_FULL);
    const result = await engine.setStep('ses_v2_entry_ok', 'S1');
    expect(result.ok).toBe(true);
    expect(result.step).toBe('S1');
    expect(result.stepName).toBe('Understand Intent');
  });

  it('rejects first entry into a non-start step with warning and start set', async () => {
    await startTask(engine, 'ses_v2_entry_bad', V2_FULL);
    const result = await engine.setStep('ses_v2_entry_bad', 'S3');
    expect(result.ok).toBe(false);
    expect(result.warning).toBeTruthy();
    expect(result.legalTargets).toEqual(['S1']);

    const task = await memory.getActiveTask('ses_v2_entry_bad');
    expect(task!.currentStep).toBe('');
  });

  it('allows a legal transition between steps', async () => {
    await startTask(engine, 'ses_v2_legal', V2_FULL);
    await engine.setStep('ses_v2_legal', 'S1');
    const result = await engine.setStep('ses_v2_legal', 'S2');
    expect(result.ok).toBe(true);
    expect(result.step).toBe('S2');
  });

  it('rejects an illegal transition with warning, legal targets, and unchanged state', async () => {
    await startTask(engine, 'ses_v2_illegal', V2_FULL);
    await engine.setStep('ses_v2_illegal', 'S1');

    const result = await engine.setStep('ses_v2_illegal', 'S4');
    expect(result.ok).toBe(false);
    expect(result.warning).toContain('S4');
    expect(result.legalTargets).toEqual(['S2']);

    const task = await memory.getActiveTask('ses_v2_illegal');
    expect(task!.currentStep).toBe('S1');
    expect(task!.stepTransitions).toHaveLength(1);
  });

  it('treats rollback edges as legal transitions', async () => {
    await startTask(engine, 'ses_v2_rollback', V2_FULL);
    await engine.setStep('ses_v2_rollback', 'S1');
    await engine.setStep('ses_v2_rollback', 'S2');
    await engine.setStep('ses_v2_rollback', 'S3');

    const result = await engine.setStep('ses_v2_rollback', 'S2');
    expect(result.ok).toBe(true);
    expect(result.step).toBe('S2');
  });

  it('is idempotent when re-entering the current step', async () => {
    await startTask(engine, 'ses_v2_idem', V2_FULL);
    await engine.setStep('ses_v2_idem', 'S1');

    const result = await engine.setStep('ses_v2_idem', 'S1');
    expect(result.ok).toBe(true);
    expect(result.step).toBe('S1');

    const task = await memory.getActiveTask('ses_v2_idem');
    expect(task!.stepTransitions).toHaveLength(1);
  });

  it('does not attach a degraded notice on a valid FSM flow', async () => {
    await startTask(engine, 'ses_v2_nonotice', V2_FULL);
    const result = await engine.setStep('ses_v2_nonotice', 'S1');
    expect(result.notice).toBeUndefined();
  });
});

describe('FSM Validation: forced transitions', () => {
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

  it('force=true bypasses FSM validation and attaches a forced notice', async () => {
    await startTask(engine, 'ses_v2_force_ok', V2_FULL);
    await engine.setStep('ses_v2_force_ok', 'S1');

    const result = await engine.setStep('ses_v2_force_ok', 'S4', true);
    expect(result.ok).toBe(true);
    expect(result.step).toBe('S4');
    expect(result.notice).toBeTruthy();
    expect(result.warning).toBeUndefined();

    const task = await memory.getActiveTask('ses_v2_force_ok');
    expect(task!.currentStep).toBe('S4');
    expect(task!.stepTransitions).toHaveLength(2);
  });

  it('force=true rejects a target step that does not exist in the flow document', async () => {
    await startTask(engine, 'ses_v2_force_missing', V2_FULL);
    await engine.setStep('ses_v2_force_missing', 'S1');

    const result = await engine.setStep('ses_v2_force_missing', 'S99', true);
    expect(result.ok).toBe(false);
    expect(result.warning).toContain('S99');

    const task = await memory.getActiveTask('ses_v2_force_missing');
    expect(task!.currentStep).toBe('S1');
    expect(task!.stepTransitions).toHaveLength(1);
  });

  it('force=true allows first entry into a non-start step that exists', async () => {
    await startTask(engine, 'ses_v2_force_entry', V2_FULL);

    const result = await engine.setStep('ses_v2_force_entry', 'S3', true);
    expect(result.ok).toBe(true);
    expect(result.step).toBe('S3');
  });

  it('still rejects an illegal transition without force (regression)', async () => {
    await startTask(engine, 'ses_v2_force_regression', V2_FULL);
    await engine.setStep('ses_v2_force_regression', 'S1');

    const result = await engine.setStep('ses_v2_force_regression', 'S4');
    expect(result.ok).toBe(false);
  });

  it('force=true on a legacy 0.1 flow behaves identically to a free transition', async () => {
    await startTask(engine, 'ses_v1_force', V1_LEGACY);

    const result = await engine.setStep('ses_v1_force', 'S2', true);
    expect(result.ok).toBe(true);
    expect(result.step).toBe('S2');
    expect(result.notice).toBeUndefined();
  });
});

describe('FSM Validation: legacy 0.1 flow', () => {
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

  it('allows free transitions without validation', async () => {
    await startTask(engine, 'ses_v1_free', V1_LEGACY);

    const first = await engine.setStep('ses_v1_free', 'S2');
    expect(first.ok).toBe(true);
    expect(first.step).toBe('S2');
    expect(first.warning).toBeUndefined();
    expect(first.notice).toBeUndefined();

    const second = await engine.setStep('ses_v1_free', 'S1');
    expect(second.ok).toBe(true);

    const task = await memory.getActiveTask('ses_v1_free');
    expect(task!.currentStep).toBe('S1');
  });
});

describe('FSM Validation: degraded V2 flows', () => {
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

  it('switches freely and attaches a degraded notice when no FSM exists', async () => {
    await startTask(engine, 'ses_v2_nofsm', V2_NO_FSM);
    const result = await engine.setStep('ses_v2_nofsm', 'S2');
    expect(result.ok).toBe(true);
    expect(result.step).toBe('S2');
    expect(result.notice).toBeTruthy();
  });

  it('switches freely and attaches a degraded notice on a broken FSM', async () => {
    await startTask(engine, 'ses_v2_badfsm', V2_BAD_FSM);
    const result = await engine.setStep('ses_v2_badfsm', 'S1');
    expect(result.ok).toBe(true);
    expect(result.notice).toBeTruthy();
  });
});

describe('Flow Parser: acceptance standard & rollback targets', () => {
  it('parses the acceptance standard section for V2 flows', async () => {
    const { parseFlowDocument } = await import('../../src/engine/flow-parser.js');
    const raw = fs.readFileSync(path.join(FIXTURES, `flow-${V2_FULL}.md`), 'utf-8');
    const definition = parseFlowDocument(raw, V2_FULL);
    expect(definition.acceptanceStandard).toBe('Code changes + tests passing');

    const legacy = parseFlowDocument(
      fs.readFileSync(path.join(FIXTURES, `flow-${V1_LEGACY}.md`), 'utf-8'),
      V1_LEGACY,
    );
    expect(legacy.acceptanceStandard).toBe('');
  });

  it('resolves rollback targets from FSM edges per reason', async () => {
    const { getRollbackTarget, parseFlowDocument } = await import(
      '../../src/engine/flow-parser.js',
    );
    const raw = fs.readFileSync(path.join(FIXTURES, `flow-${V2_FULL}.md`), 'utf-8');
    const definition = parseFlowDocument(raw, V2_FULL);

    expect(getRollbackTarget(definition, 'S3', 'Execution problem')).toBe('S3');
    expect(getRollbackTarget(definition, 'S3', 'Design problem')).toBe('S2');
    expect(getRollbackTarget(definition, 'S3', 'Unreasonable acceptance criteria')).toBeNull();
    expect(getRollbackTarget(definition, 'S1', 'Design problem')).toBeNull();
  });

  it('resolves Chinese rollback labels as aliases', async () => {
    const { getRollbackTarget, parseFlowDocument } = await import(
      '../../src/engine/flow-parser.js',
    );
    const raw = [
      '**Template ID**: `t`',
      '## 状态机',
      '```mermaid',
      'stateDiagram-v2',
      '    [*] --> S1_Start',
      '    S1_Start --> S2_Do: 审查不通过-执行问题',
      '    S1_Start --> S3_Plan: 审查不通过-设计问题',
      '```',
      '### S1: Start',
      '**Output**: x',
    ].join('\n');
    const definition = parseFlowDocument(raw, 't');

    expect(getRollbackTarget(definition, 'S1', 'Execution problem')).toBe('S2');
    expect(getRollbackTarget(definition, 'S1', 'Design problem')).toBe('S3');
  });
});

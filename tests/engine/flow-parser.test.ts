/**
 * Flow Parser Tests
 *
 * Covers 0.2 format step metadata parsing, mermaid FSM subset parsing,
 * degradation paths, and the helper query functions.
 */

import { describe, it, expect } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  getLegalTargets,
  getStepName,
  parseFlowDocument,
} from '../../src/engine/flow-parser.js';

const FIXTURES = path.join(import.meta.dirname, 'fixtures');

function loadFixture(name: string): string {
  return fs.readFileSync(path.join(FIXTURES, name), 'utf-8');
}

describe('Flow Parser: 0.2 format steps', () => {
  const raw = loadFixture('flow-v2-full.md');
  const def = parseFlowDocument(raw, 'v2-full');

  it('detects the 0.2 format via the Output field', () => {
    expect(def.isV2).toBe(true);
  });

  it('parses header meta', () => {
    expect(def.templateId).toBe('v2-full');
    expect(def.version).toBe('2.0.0');
  });

  it('parses all four steps with numbers and names', () => {
    expect(def.steps.map((s) => s.id)).toEqual(['S1', 'S2', 'S3', 'S4']);
    expect(def.steps[0].name).toBe('Understand Intent');
    expect(def.steps[2].name).toBe('Implement');
  });

  it('parses step field values', () => {
    const s2 = def.steps[1];
    expect(s2.goal).toBe('Produce a confirmed design');
    expect(s2.output).toBe('Design document');
    expect(s2.outputChecklist).toEqual(['Covers all points', 'Follows project patterns']);
    expect(s2.reviewChecklist).toEqual([]);
    expect(s2.outputReview).toEqual(['self-check', 'human']);
    expect(s2.referencedRegulations).toEqual(['constitution.md', 'coding_style.md']);
    expect(s2.uponCompletion).toBe('User confirms → S3');
  });

  it('parses the Review Checklist field for review-agent steps', () => {
    const s3 = def.steps[2];
    expect(s3.reviewChecklist).toEqual([
      'Implementation aligns with the design',
      'No unnecessary refactoring',
    ]);
  });

  it('parses placeholder steps as empty collections', () => {
    const s1 = def.steps[0];
    expect(s1.outputChecklist).toEqual([]);
    expect(s1.reviewChecklist).toEqual([]);
    expect(s1.outputReview).toEqual(['human']);
    expect(s1.referencedRegulations).toEqual([]);
  });

  it('parses combined review modes', () => {
    expect(def.steps[2].outputReview).toEqual(['self-check', 'review-agent', 'human']);
  });
});

describe('Flow Parser: FSM parsing', () => {
  const raw = loadFixture('flow-v2-full.md');
  const def = parseFlowDocument(raw, 'v2-full');

  it('is not degraded when FSM parses', () => {
    expect(def.fsmDegraded).toBe(false);
  });

  it('extracts the start set from [*] edges', () => {
    expect(def.startSteps).toEqual(['S1']);
  });

  it('parses normal edges with normalized step numbers', () => {
    const hasEdge = (from: string, to: string) =>
      def.edges.some((e) => e.from === from && e.to === to);
    expect(hasEdge('S1', 'S2')).toBe(true);
    expect(hasEdge('S2', 'S3')).toBe(true);
    expect(hasEdge('S3', 'S4')).toBe(true);
    expect(hasEdge('S4', 'S3')).toBe(true);
  });

  it('parses self-loop rollback edges with labels', () => {
    const edge = def.edges.find((e) => e.from === 'S3' && e.to === 'S3');
    expect(edge).toBeDefined();
    expect(edge!.label).toBe('Review failed-Execution problem');
    expect(edge!.isRollback).toBe(true);
  });

  it('marks rollback edges by label convention', () => {
    const edge = def.edges.find((e) => e.from === 'S3' && e.to === 'S2');
    expect(edge!.isRollback).toBe(true);
    expect(edge!.label).toBe('Review failed-Design problem');
  });

  it('parses terminal edges without treating [*] as a target step', () => {
    const terminal = def.edges.find((e) => e.to === '*');
    expect(terminal).toBeDefined();
    expect(terminal!.from).toBe('S4');
    expect(terminal!.label).toBe('User approves');
  });

  it('skips note blocks entirely', () => {
    const noteEdges = def.edges.filter((e) => /intervention|⚠️/i.test(e.label));
    expect(noteEdges).toEqual([]);
  });

  it('still recognizes legacy Chinese rollback labels', () => {
    const raw = `# T

**Template ID**: \`t\`

\`\`\`mermaid
stateDiagram-v2
    [*] --> S1_意图理解
    S1_意图理解 --> S1_意图理解: 审查不通过-执行问题
    S1_意图理解 --> [*]
\`\`\`

### S1: 理解

**Output**: x
**Output Review**: human

1. do
`;
    const legacy = parseFlowDocument(raw, 't');
    const edge = legacy.edges.find((e) => e.from === 'S1' && e.to === 'S1');
    expect(edge).toBeDefined();
    expect(edge!.isRollback).toBe(true);
  });
});

describe('Flow Parser: legacy 0.1 documents', () => {
  const raw = loadFixture('flow-v1-legacy.md');
  const def = parseFlowDocument(raw, 'v1-legacy');

  it('is not treated as 0.2 format', () => {
    expect(def.isV2).toBe(false);
  });

  it('still parses step numbers and names', () => {
    expect(def.steps.map((s) => s.id)).toEqual(['S1', 'S2', 'S3']);
    expect(def.steps[0].name).toBe('理解需求');
  });

  it('leaves 0.2-only fields empty', () => {
    expect(def.steps.every((s) => s.output === '')).toBe(true);
    expect(def.steps.every((s) => s.outputReview.length === 0)).toBe(true);
  });

  it('still parses the FSM for legacy documents', () => {
    expect(def.fsmDegraded).toBe(false);
    expect(def.startSteps).toEqual(['S1']);
  });
});

describe('Flow Parser: degradation paths', () => {
  it('degrades when no mermaid block exists', () => {
    const def = parseFlowDocument(loadFixture('flow-v2-no-fsm.md'), 'v2-no-fsm');
    expect(def.isV2).toBe(true);
    expect(def.fsmDegraded).toBe(true);
    expect(def.edges).toEqual([]);
    expect(def.startSteps).toEqual([]);
    expect(def.parseWarnings.some((w) => w.includes('no stateDiagram-v2'))).toBe(true);
  });

  it('degrades when no parseable edges exist', () => {
    const def = parseFlowDocument(loadFixture('flow-v2-bad-fsm.md'), 'v2-bad-fsm');
    expect(def.fsmDegraded).toBe(true);
    expect(def.edges).toEqual([]);
    expect(def.parseWarnings.some((w) => w.includes('no parseable FSM edges'))).toBe(true);
  });

  it('warns on mixed-format documents', () => {
    const mixed = `${loadFixture('flow-v1-legacy.md')}
### S9: Extra

**Output**: Some output
**Output Review**: human

1. Do something
`;
    const def = parseFlowDocument(mixed, 'mixed');
    expect(def.isV2).toBe(true);
    expect(def.parseWarnings.some((w) => w.includes('mixed format'))).toBe(true);
  });
});

describe('Flow Parser: helpers', () => {
  const def = parseFlowDocument(loadFixture('flow-v2-full.md'), 'v2-full');

  it('getLegalTargets returns outgoing targets for a step', () => {
    expect(getLegalTargets(def, 'S3').sort()).toEqual(['S2', 'S3', 'S4']);
    expect(getLegalTargets(def, 'S1')).toEqual(['S2']);
  });

  it('getLegalTargets returns the start set for an empty step', () => {
    expect(getLegalTargets(def, '')).toEqual(['S1']);
  });

  it('getLegalTargets excludes terminal edges', () => {
    const targets = getLegalTargets(def, 'S4');
    expect(targets).not.toContain('*');
  });

  it('getStepName resolves step names and returns null for unknown steps', () => {
    expect(getStepName(def, 'S2')).toBe('Design');
    expect(getStepName(def, 'S9')).toBeNull();
  });
});

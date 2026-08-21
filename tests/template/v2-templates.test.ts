/**
 * V2 Template Parsing Tests
 *
 * Verifies that the 6 built-in templates follow the 0.2 format and can be
 * parsed by the Flow Parser (acceptance criteria #7/#9/#10):
 *   - isV2 = true, expected step count, FSM start set = [S1]
 *   - rollback edges present with `Review failed-{reason}` labels
 *   - scanTemplates no longer lists deprecated templates (design-spec / large-refactor)
 */

import { describe, it, expect } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseFlowDocument } from '../../src/engine/flow-parser.js';
import { scanTemplates } from '../../src/template/index.js';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..', '..');
const TEMPLATE_DIR = path.join(PROJECT_ROOT, 'docs', 'template');

interface TemplateExpectation {
  id: string;
  stepCount: number;
  /** Step that carries the review-agent verification mode */
  reviewAgentStep?: string;
  /** Step ids that must have a `Review failed-` rollback edge */
  rollbackFrom: string[];
}

const EXPECTATIONS: TemplateExpectation[] = [
  { id: 'research', stepCount: 4, rollbackFrom: ['S4'] },
  { id: 'arch-design', stepCount: 5, rollbackFrom: ['S4'] },
  { id: 'feat-design', stepCount: 3, rollbackFrom: ['S3'] },
  { id: 'spec-driven-dev', stepCount: 6, reviewAgentStep: 'S5', rollbackFrom: ['S5'] },
  { id: 'bug-fix', stepCount: 4, reviewAgentStep: 'S3', rollbackFrom: ['S3'] },
  { id: 'side-job', stepCount: 5, reviewAgentStep: 'S4', rollbackFrom: ['S4'] },
];

function readTemplateFlow(id: string): string {
  const fp = path.join(TEMPLATE_DIR, id, 'flow.md');
  return fs.readFileSync(fp, 'utf-8');
}

describe('V2 built-in templates', () => {
  for (const exp of EXPECTATIONS) {
    describe(exp.id, () => {
      const def = parseFlowDocument(readTemplateFlow(exp.id), exp.id);

      it('is parsed as 0.2 format (isV2)', () => {
        expect(def.isV2).toBe(true);
      });

      it(`has expected step count (${exp.stepCount})`, () => {
        expect(def.steps).toHaveLength(exp.stepCount);
        expect(def.steps.map((s) => s.id)).toEqual(
          Array.from({ length: exp.stepCount }, (_, i) => `S${i + 1}`),
        );
      });

      it('has FSM start set [S1] and no degradation', () => {
        expect(def.fsmDegraded).toBe(false);
        expect(def.startSteps).toEqual(['S1']);
      });

      it('defines rollback edges with Review failed- labels', () => {
        const rollbackEdges = def.edges.filter((e) => e.isRollback);
        expect(rollbackEdges.length).toBeGreaterThan(0);
        for (const edge of rollbackEdges) {
          expect(edge.label.startsWith('Review failed-')).toBe(true);
        }
        for (const from of exp.rollbackFrom) {
          const hasFrom = rollbackEdges.some((e) => e.from === from);
          expect(hasFrom).toBe(true);
        }
      });

      if (exp.reviewAgentStep) {
        it(`has review-agent verification on ${exp.reviewAgentStep}`, () => {
          const step = def.steps.find((s) => s.id === exp.reviewAgentStep);
          expect(step?.outputReview).toContain('review-agent');
        });
      }
    });
  }

  it('parses acceptance standards section', () => {
    const def = parseFlowDocument(readTemplateFlow('side-job'), 'side-job');
    expect(def.acceptanceStandard.length).toBeGreaterThan(0);
  });
});

describe('Template library inventory', () => {
  it('lists the 6 v2 templates', () => {
    const templates = scanTemplates(PROJECT_ROOT);
    const ids = templates.map((t) => t.id);
    for (const exp of EXPECTATIONS) {
      expect(ids).toContain(exp.id);
    }
  });

  it('does not list deprecated templates (design-spec / large-refactor)', () => {
    const templates = scanTemplates(PROJECT_ROOT);
    const ids = templates.map((t) => t.id);
    expect(ids).not.toContain('design-spec');
    expect(ids).not.toContain('large-refactor');
  });
});
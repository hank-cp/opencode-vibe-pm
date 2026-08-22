/**
 * Review Framework Tests
 *
 * Pure-function coverage for review/journal prompt building and review
 * output parsing (JSON fenced block contract, validation, conservative
 * fallback).
 */

import { describe, it, expect } from 'bun:test';
import {
  buildJournalPrompt,
  buildReviewPrompt,
  conservativeReviewFallback,
  parseReviewOutput,
} from '../../src/engine/review-framework.js';

const REVIEW_INPUT = {
  taskSummary: 'Implement JWT auth',
  flow: 'spec-driven-dev',
  stepId: 'S5',
  stepName: 'Write Code & Tests',
  acceptanceStandard: 'All tests pass, no type escape',
  reviewChecklist: [] as string[],
  conversationExcerpt: '--- user ---\nimplement it\n--- assistant ---\ndone',
};

const JOURNAL_INPUT = {
  taskSummary: 'Implement JWT auth',
  flow: 'spec-driven-dev',
  fromStep: 'S4',
  toStep: 'S5',
  toStepName: 'Write Code & Tests',
  conversationExcerpt: '--- assistant ---\nplan approved',
};

describe('buildReviewPrompt', () => {
  it('injects all placeholders into the framework', () => {
    const prompt = buildReviewPrompt(REVIEW_INPUT);
    expect(prompt).toContain('Implement JWT auth');
    expect(prompt).toContain('spec-driven-dev');
    expect(prompt).toContain('S5 Write Code & Tests');
    expect(prompt).toContain('All tests pass, no type escape');
    expect(prompt).toContain('--- user ---');
    expect(prompt).toContain('Do NOT call any pm_* tools');
    expect(prompt).toContain('```json');
  });

  it('falls back for empty acceptance standard and excerpt', () => {
    const prompt = buildReviewPrompt({
      ...REVIEW_INPUT,
      acceptanceStandard: '',
      conversationExcerpt: '',
    });
    expect(prompt).toContain('Not specified');
    expect(prompt).toContain('(no excerpt available)');
  });

  it('injects the review checklist as bullets', () => {
    const prompt = buildReviewPrompt({
      ...REVIEW_INPUT,
      reviewChecklist: ['Implementation aligns with the design', 'No unnecessary refactoring'],
    });
    expect(prompt).toContain('## Step review checklist');
    expect(prompt).toContain('- Implementation aligns with the design');
    expect(prompt).toContain('- No unnecessary refactoring');
    expect(prompt).not.toContain('{reviewChecklist}');
  });

  it('injects a None marker when the review checklist is empty', () => {
    const prompt = buildReviewPrompt(REVIEW_INPUT);
    expect(prompt).toContain('None (no step-level review checklist declared)');
    expect(prompt).not.toContain('{reviewChecklist}');
  });

  it('uses a custom framework override when provided', () => {
    const prompt = buildReviewPrompt(REVIEW_INPUT, 'Custom framework: {stepId}');
    expect(prompt).toBe('Custom framework: S5');
  });
});

describe('buildJournalPrompt', () => {
  it('injects transition context and constraints', () => {
    const prompt = buildJournalPrompt(JOURNAL_INPUT);
    expect(prompt).toContain('Implement JWT auth');
    expect(prompt).toContain('S4 → S5 (Write Code & Tests)');
    expect(prompt).toContain('Do NOT call any pm_* tools');
    expect(prompt).toContain('1-3 lines each');
  });
});

describe('parseReviewOutput', () => {
  it('parses a valid pass verdict', () => {
    const text = 'Looks good.\n```json\n{"conclusion":"pass","feedback":"fine","nextInput":"proceed"}\n```';
    const result = parseReviewOutput(text);
    expect(result.parsed).toEqual({
      conclusion: 'pass',
      feedback: 'fine',
      nextInput: 'proceed',
    });
  });

  it('parses a valid fail verdict with reason', () => {
    const text =
      '```json\n{"conclusion":"fail","failReason":"Design problem","feedback":"redo","nextInput":"go back"}\n```';
    const result = parseReviewOutput(text);
    expect(result.parsed?.conclusion).toBe('fail');
    expect(result.parsed?.failReason).toBe('Design problem');
  });

  it('returns parsed null when no JSON block exists', () => {
    const result = parseReviewOutput('just some text, no json');
    expect(result.parsed).toBeNull();
    expect(result.raw).toBe('just some text, no json');
  });

  it('returns parsed null on malformed JSON', () => {
    const result = parseReviewOutput('```json\n{not valid json}\n```');
    expect(result.parsed).toBeNull();
  });

  it('returns parsed null when fail lacks failReason', () => {
    const text = '```json\n{"conclusion":"fail","feedback":"x","nextInput":"y"}\n```';
    expect(parseReviewOutput(text).parsed).toBeNull();
  });

  it('returns parsed null on unknown enum values', () => {
    const text = '```json\n{"conclusion":"maybe","feedback":"x","nextInput":"y"}\n```';
    expect(parseReviewOutput(text).parsed).toBeNull();
  });

  it('extracts only the first JSON block', () => {
    const text =
      '```json\n{"conclusion":"pass","feedback":"a","nextInput":"b"}\n```\n```json\n{"conclusion":"fail","failReason":"Execution problem","feedback":"c","nextInput":"d"}\n```';
    const result = parseReviewOutput(text);
    expect(result.parsed?.conclusion).toBe('pass');
  });
});

describe('conservativeReviewFallback', () => {
  it('produces fail + Execution problem with the raw text attached', () => {
    const fallback = conservativeReviewFallback('weird output');
    expect(fallback.conclusion).toBe('fail');
    expect(fallback.failReason).toBe('Execution problem');
    expect(fallback.feedback).toContain('weird output');
  });
});

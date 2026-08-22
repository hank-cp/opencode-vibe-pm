/**
 * Review & Journal Prompt Framework
 *
 * Pure functions building the prompts for the Review Agent and Journaler
 * sub-sessions, plus the parser turning a review agent's raw text output
 * into a structured verdict (Spec: "审查 Agent 输出格式约定").
 *
 * No I/O, no external dependencies besides zod — fully unit-testable.
 */

import { z } from 'zod';

// ─── Review Prompt ───

export interface ReviewPromptInput {
  taskSummary: string;
  flow: string;
  stepId: string;
  stepName: string;
  acceptanceStandard: string;
  /** Step-level review checklist (`**Review Checklist**` items); empty when undeclared */
  reviewChecklist: string[];
  conversationExcerpt: string;
}

export const DEFAULT_REVIEW_FRAMEWORK = [
  'You are an output review agent for a task-driven development workflow (vibe-pm).',
  'Your job: verify the current step output against its goal and the task acceptance standard.',
  '',
  '## Task context',
  '- Task summary: {taskSummary}',
  '- Flow: {flow}',
  '- Step under review: {stepId} {stepName}',
  '- Acceptance standard: {acceptanceStandard}',
  '',
  '## Review principles',
  '1. Goal fulfillment — the step output achieves the step declared Output.',
  '2. Acceptance alignment — the output aligns with the acceptance standard.',
  '3. Scope discipline — no changes beyond the agreed scope.',
  '4. Quality gates — build/tests/diagnostics evidence is present and clean.',
  '5. Type safety — no type escape (any / @ts-ignore) or empty catch blocks.',
  '',
  '## Step review checklist',
  '{reviewChecklist}',
  '',
  '## Step execution excerpt (recent conversation)',
  '{conversationExcerpt}',
  '',
  '## Output format',
  'Respond with your review. You MUST include a JSON fenced block (```json) as the final part:',
  '{',
  '  "conclusion": "pass" or "fail",',
  '  "failReason": "Execution problem" | "Design problem" | "Unreasonable acceptance criteria" (required when fail),',
  '  "feedback": "review comments and suggestions",',
  '  "nextInput": "a short briefing for the main session about the review outcome"',
  '}',
  '',
  '## Rules',
  '- Do NOT call any pm_* tools (no starting flows, no step transitions).',
  '- Do NOT ask questions; output only the review text.',
  '- You may read files and run read-only verification commands (build/test) if needed.',
].join('\n');

export function buildReviewPrompt(
  input: ReviewPromptInput,
  framework: string = DEFAULT_REVIEW_FRAMEWORK,
): string {
  const checklistText =
    input.reviewChecklist.length > 0
      ? input.reviewChecklist.map((item) => `- ${item}`).join('\n')
      : 'None (no step-level review checklist declared)';
  return framework
    .replaceAll('{taskSummary}', input.taskSummary)
    .replaceAll('{flow}', input.flow)
    .replaceAll('{stepId}', input.stepId)
    .replaceAll('{stepName}', input.stepName)
    .replaceAll('{acceptanceStandard}', input.acceptanceStandard || 'Not specified')
    .replaceAll('{reviewChecklist}', checklistText)
    .replaceAll('{conversationExcerpt}', input.conversationExcerpt || '(no excerpt available)');
}

// ─── Review Output Parsing ───

export const ReviewFailReasons = [
  'Execution problem',
  'Design problem',
  'Unreasonable acceptance criteria',
] as const;

export type ReviewFailReason = (typeof ReviewFailReasons)[number];

export const ReviewOutputSchema = z
  .object({
    conclusion: z.enum(['pass', 'fail']),
    failReason: z.enum(ReviewFailReasons).optional(),
    feedback: z.string().min(1),
    nextInput: z.string().min(1),
  })
  .superRefine((value, ctx) => {
    if (value.conclusion === 'fail' && !value.failReason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'failReason is required when conclusion is "fail"',
      });
    }
  });

export type ParsedReviewOutput = z.infer<typeof ReviewOutputSchema>;

export interface ReviewParseResult {
  parsed: ParsedReviewOutput | null;
  raw: string;
}

const JSON_FENCE_RE = /```json\s*([\s\S]*?)```/;

/**
 * Extract the JSON fenced block from the review agent output and validate it
 * against the ReviewOutputSchema. Returns `parsed: null` when the block is
 * missing or fails validation — callers then apply the conservative fallback
 * (fail + Execution problem) per Spec.
 */
export function parseReviewOutput(text: string): ReviewParseResult {
  const match = text.match(JSON_FENCE_RE);
  if (!match) return { parsed: null, raw: text.trim() };

  let json: unknown;
  try {
    json = JSON.parse(match[1].trim());
  } catch {
    return { parsed: null, raw: text.trim() };
  }

  const result = ReviewOutputSchema.safeParse(json);
  return result.success ? { parsed: result.data, raw: text.trim() } : { parsed: null, raw: text.trim() };
}

/** Conservative fallback verdict for unparseable review output */
export function conservativeReviewFallback(raw: string): ParsedReviewOutput {
  return {
    conclusion: 'fail',
    failReason: 'Execution problem',
    feedback: `Review output could not be parsed as the agreed JSON format. Raw output:\n\n${raw}`,
    nextInput:
      '审查输出格式非法，按「不通过-执行问题」保守处理：请加强自查后重做本步骤，并提示用户本步骤的人工审查更为重要。',
  };
}

// ─── Journal Prompt ───

export interface JournalPromptInput {
  taskSummary: string;
  flow: string;
  fromStep: string;
  toStep: string;
  toStepName: string;
  conversationExcerpt: string;
}

export const DEFAULT_JOURNAL_FRAMEWORK = [
  'You are a journaler for a task-driven development workflow (vibe-pm).',
  'Record a concise briefing for a step transition.',
  '',
  '- Task summary: {taskSummary}',
  '- Flow: {flow}',
  '- Transition: {fromStep} → {toStep} ({toStepName})',
  '',
  '## Conversation excerpt (recent messages)',
  '{conversationExcerpt}',
  '',
  '## Output',
  'Write a briefing with exactly four sections, 1-3 lines each:',
  '1. Progress — what was accomplished in the exited step',
  '2. User decisions & feedback — key decisions/confirmations by the user',
  '3. Review summaries — outcomes of reviews/checks (if any)',
  '4. Understanding deviations & corrections — misunderstandings corrected (if any)',
  'If a section has no content, write "None".',
  '',
  '## Rules',
  '- Output only the briefing text (no preamble).',
  '- Do NOT call any pm_* tools. Do NOT ask questions. Do NOT edit files.',
].join('\n');

export function buildJournalPrompt(
  input: JournalPromptInput,
  framework: string = DEFAULT_JOURNAL_FRAMEWORK,
): string {
  return framework
    .replaceAll('{taskSummary}', input.taskSummary)
    .replaceAll('{flow}', input.flow)
    .replaceAll('{fromStep}', input.fromStep)
    .replaceAll('{toStep}', input.toStep)
    .replaceAll('{toStepName}', input.toStepName)
    .replaceAll('{conversationExcerpt}', input.conversationExcerpt || '(no excerpt available)');
}

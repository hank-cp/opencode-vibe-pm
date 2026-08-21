/**
 * Flow Parser
 *
 * Parses a flow definition document (`docs/flow/flow-{name}.md`) into a
 * structured FlowDefinition:
 *
 *   - Step metadata: step heading + 0.2 format English field keys
 *     (`Goal` / `Output` / `Output Checklist` / `Output Review` /
 *     `Referenced Regulation` / `Upon completion`).
 *   - FSM transitions: the project-convention subset of mermaid
 *     `stateDiagram-v2` — state nodes (`S{n}_name`), `-->` edges,
 *     edge labels, `note` blocks (skipped), and `[*]` start/end states.
 *
 * Degradation policy: never throws for malformed documents. Parse problems
 * are collected as warnings and surfaced via `fsmDegraded`, so the caller
 * (Flow Engine) can fall back to no-validation mode. This module is pure —
 * no filesystem access, no external dependencies.
 */

// ─── Types ───

export interface FlowStep {
  /** Step number, e.g. "S1" */
  id: string;
  /** Step name from the heading, stripped of `[Human-in-loop]` / ⚠️ markers */
  name: string;
  /** `**Goal**` field text (empty for legacy 0.1 documents) */
  goal: string;
  /** `**Output**` field text — the 0.2 format signal (empty for legacy documents) */
  output: string;
  /** `**Output Checklist**` items; empty when not declared or marked "—" */
  outputChecklist: string[];
  /** `**Output Review**` values split on `+`, e.g. ["self-check", "human"] */
  outputReview: string[];
  /** `**Referenced Regulation**` file basenames */
  referencedRegulations: string[];
  /** `**Upon completion**` transition-condition text */
  uponCompletion: string;
}

export interface TransitionEdge {
  /** Source step number, or `*` for the `[*]` start state */
  from: string;
  /** Target step number, or `*` for the `[*]` end state */
  to: string;
  /** Edge label (transition condition); empty when unlabeled */
  label: string;
  /** True when the label follows the rollback convention `Review failed-{reason}` */
  isRollback: boolean;
}

export interface FlowDefinition {
  flowName: string;
  /** `**Template ID**` from the document header (may be empty) */
  templateId: string;
  /** `**Version**` from the document header (may be empty) */
  version: string;
  /**
   * True when at least one step declares the `Output` field — the signal
   * that this document uses the 0.2 format (FSM validation is enabled
   * only for V2 documents).
   */
  isV2: boolean;
  /**
   * Task-level default acceptance standard, parsed from the
   * `## 默认交付物与交付标准` / `## Default Deliverables & Acceptance` section.
   * Empty when the section is absent.
   */
  acceptanceStandard: string;
  steps: FlowStep[];
  /** All parsed FSM edges, including `[*]` start/end edges */
  edges: TransitionEdge[];
  /** Step numbers reachable from `[*]` (FSM start set) */
  startSteps: string[];
  /**
   * True when FSM parsing is unavailable or unusable: no mermaid block,
   * no `stateDiagram-v2`, no parseable edges, or an empty start set.
   * Callers must fall back to no-validation mode.
   */
  fsmDegraded: boolean;
  /** Non-fatal parse warnings (missing fields, unparseable lines, etc.) */
  parseWarnings: string[];
}

// ─── Constants ───

/** 0.2 format English field keys, longest first for stable matching */
const FIELD_KEYS = [
  'Output Checklist',
  'Output Review',
  'Referenced Regulation',
  'Upon completion',
  'Output',
  'Goal',
] as const;

type FieldKey = (typeof FIELD_KEYS)[number];

const ROLLBACK_LABEL_PREFIXES = ['Review failed', '审查不通过'];
const TERMINAL_STATE = '*';
const EMPTY_PLACEHOLDER = '—';

// ─── Helpers ───

/** Clean a step heading name: strip `[Human-in-loop]` and ⚠️ markers */
function cleanStepName(rawName: string): string {
  return rawName
    .replace(/\[.*?\]/g, '')
    .replace(/⚠️\s*/g, '')
    .trim();
}

/** Normalize an FSM node token to a step number, `*`, or null if unrecognized */
function normalizeNode(token: string): string | null {
  if (token === '[*]') return TERMINAL_STATE;
  const m = token.match(/^S(\d+)(?:_[^\s:]+)?$/);
  if (m) return `S${m[1]}`;
  return null;
}

/** Split a field value on `+`, trimming and dropping empties */
function splitByPlus(raw: string): string[] {
  return raw
    .split('+')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Split a comma/newline-separated file list into basenames */
function splitFileList(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map((f) => f.trim().split('/').pop() ?? '')
    .filter(Boolean);
}

// ─── Header Meta ───

function parseHeaderMeta(raw: string): { templateId: string; version: string } {
  const templateId = raw.match(/\*\*Template ID\*\*:\s*`?(.+?)`?\s*$/m)?.[1]?.trim() ?? '';
  const version = raw.match(/\*\*Version\*\*:\s*(.+?)\s*$/m)?.[1]?.trim() ?? '';
  return { templateId, version };
}

// ─── Step Parsing ───

const STEP_HEADING_RE = /^###\s+S(\d+)[:：]\s*(.+)$/;
const FIELD_LINE_RE = /^\*\*([^*\n]+?)\*\*\s*:\s*(.*)$/;
const BULLET_LINE_RE = /^\s*[-*]\s+(.+)$/;
const NUMBERED_LINE_RE = /^\s*\d+[.)、]\s+.+$/;
const BLOCKQUOTE_LINE_RE = /^\s*>/;
const HORIZONTAL_LINE_RE = /^\s*-{3,}\s*$/;

interface StepBlock {
  id: string;
  name: string;
  body: string;
}

/** Split the document into step blocks by `### S{n}: {name}` headings */
function splitStepBlocks(raw: string): StepBlock[] {
  const blocks: StepBlock[] = [];
  let current: { id: string; name: string; bodyLines: string[] } | null = null;

  for (const line of raw.split('\n')) {
    const m = line.match(STEP_HEADING_RE);
    if (m) {
      if (current) {
        blocks.push({ id: current.id, name: current.name, body: current.bodyLines.join('\n') });
      }
      current = { id: `S${m[1]}`, name: cleanStepName(m[2]), bodyLines: [] };
      continue;
    }
    if (current) current.bodyLines.push(line);
  }
  if (current) {
    blocks.push({ id: current.id, name: current.name, body: current.bodyLines.join('\n') });
  }

  return blocks;
}

/**
 * Extract 0.2 field values from a step block body.
 *
 * Field matching is longest-key-first, so `Output Checklist` wins over
 * `Output`. Multi-line values are supported for checklist bullets and
 * transition-condition lists. Instruction lists, blockquotes and
 * horizontal rules terminate field collection.
 */
function extractStepFields(body: string): Omit<FlowStep, 'id' | 'name'> {
  const values = new Map<FieldKey, string[]>();
  let currentField: FieldKey | null = null;

  const appendLine = (field: FieldKey, line: string): void => {
    const list = values.get(field) ?? [];
    list.push(line);
    values.set(field, list);
  };

  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const fieldMatch = trimmed.match(FIELD_LINE_RE);
    if (fieldMatch) {
      const matchedKey = fieldMatch[1].trim();
      const key = FIELD_KEYS.find((k) => k.toLowerCase() === matchedKey.toLowerCase());
      if (!key) {
        currentField = null;
        continue;
      }
      currentField = key;
      if (fieldMatch[2].trim()) appendLine(key, fieldMatch[2].trim());
      continue;
    }

    if (!currentField) continue;
    if (
      NUMBERED_LINE_RE.test(trimmed) ||
      BLOCKQUOTE_LINE_RE.test(line) ||
      HORIZONTAL_LINE_RE.test(trimmed)
    ) {
      // Instruction list / blockquote / rule — field value collection ends
      currentField = null;
      continue;
    }
    if (BULLET_LINE_RE.test(trimmed)) {
      appendLine(currentField, trimmed.replace(BULLET_LINE_RE, '$1').trim());
      continue;
    }
    appendLine(currentField, trimmed);
  }

  const joined = (key: FieldKey): string => (values.get(key) ?? []).join('\n').trim();

  const checklist = joined('Output Checklist');
  const review = joined('Output Review');
  const regulations = joined('Referenced Regulation');

  return {
    goal: joined('Goal'),
    output: joined('Output'),
    outputChecklist:
      checklist && checklist !== EMPTY_PLACEHOLDER
        ? checklist.split('\n').map((s) => s.trim()).filter(Boolean)
        : [],
    outputReview:
      review && review !== EMPTY_PLACEHOLDER ? splitByPlus(review) : [],
    referencedRegulations:
      regulations && regulations !== EMPTY_PLACEHOLDER ? splitFileList(regulations) : [],
    uponCompletion: joined('Upon completion'),
  };
}

// ─── FSM Parsing ───

const EDGE_LINE_RE = /^\s*(\S+)\s*-->\s*(\S+)\s*(?::\s*(.*?))?\s*$/;
const NOTE_START_RE = /^\s*note\b/;
const NOTE_END_RE = /^\s*end\s+note\s*$/;

interface FsmParseOutcome {
  edges: TransitionEdge[];
  startSteps: string[];
  degraded: boolean;
  warnings: string[];
}

function parseFsm(raw: string): FsmParseOutcome {
  const mermaidBlock = findStateDiagramBlock(raw);
  if (!mermaidBlock) {
    return {
      edges: [],
      startSteps: [],
      degraded: true,
      warnings: ['no stateDiagram-v2 mermaid block found, FSM validation disabled'],
    };
  }

  const edges: TransitionEdge[] = [];
  const startSteps = new Set<string>();
  const warnings: string[] = [];
  let inNote = false;

  for (const rawLine of mermaidBlock.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    if (inNote) {
      if (NOTE_END_RE.test(line)) inNote = false;
      continue;
    }
    if (NOTE_START_RE.test(line)) {
      inNote = true;
      continue;
    }

    const m = line.match(EDGE_LINE_RE);
    if (!m) continue;

    const from = normalizeNode(m[1]);
    const to = normalizeNode(m[2]);
    if (from === null || to === null) {
      warnings.push(`unrecognized FSM node in edge: ${line}`);
      continue;
    }

    const label = m[3]?.trim() ?? '';
    edges.push({
      from,
      to,
      label,
      isRollback: ROLLBACK_LABEL_PREFIXES.some((p) => label.startsWith(p)) || /rollback/i.test(label),
    });

    if (from === TERMINAL_STATE && to !== TERMINAL_STATE) {
      startSteps.add(to);
    }
  }

  let degraded = false;
  if (edges.length === 0) {
    degraded = true;
    warnings.push('no parseable FSM edges, FSM validation disabled');
  } else if (startSteps.size === 0) {
    degraded = true;
    warnings.push('FSM start set is empty (no [*] outgoing edges), FSM validation disabled');
  }

  return { edges, startSteps: [...startSteps], degraded, warnings };
}

/** Find the mermaid code block containing a `stateDiagram-v2` diagram */
function findStateDiagramBlock(raw: string): string | null {
  const blockRe = /```mermaid\s*\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(raw)) !== null) {
    const body = match[1];
    if (/stateDiagram-v2\b/.test(body)) return body;
  }
  return null;
}

// ─── Acceptance Standard Parsing ───

const ACCEPTANCE_SECTION_HEADING_RE =
  /^##\s+(?:默认交付物与交付标准|Default\s+Deliverables?(?:\s*(?:&|and)\s+Acceptance\s+(?:Standards?|Criteria))?)\s*$/i;

/**
 * Extract the task-level default acceptance standard from the
 * `## Default Deliverables` (or `## 默认交付物与交付标准`) section: raw body
 * text between that heading and the next `## ` heading (or end of document).
 */
function parseAcceptanceStandard(raw: string): string {
  const lines = raw.split('\n');
  let inSection = false;
  const body: string[] = [];

  for (const line of lines) {
    if (inSection) {
      if (/^##\s+/.test(line) || /^-{3,}\s*$/.test(line.trim())) break;
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith('>')) continue;
      body.push(trimmed.replace(/^[-*]\s+/, ''));
      continue;
    }
    if (ACCEPTANCE_SECTION_HEADING_RE.test(line.trim())) {
      inSection = true;
    }
  }

  return body.join('\n').trim();
}

// ─── Public API ───

export function parseFlowDocument(raw: string, flowName: string): FlowDefinition {
  const { templateId, version } = parseHeaderMeta(raw);

  const steps: FlowStep[] = splitStepBlocks(raw).map((block) => ({
    id: block.id,
    name: block.name,
    ...extractStepFields(block.body),
  }));

  const fsm = parseFsm(raw);
  const warnings: string[] = [];

  const isV2 = steps.some((s) => s.output !== '');
  if (isV2) {
    // Mixed-format document: some steps carry the 0.2 Output field, others do not
    const missingOutput = steps.filter((s) => s.output === '').map((s) => s.id);
    if (missingOutput.length > 0) {
      warnings.push(`mixed format: steps missing Output field: ${missingOutput.join(', ')}`);
    }
  }

  return {
    flowName,
    templateId,
    version,
    isV2,
    acceptanceStandard: parseAcceptanceStandard(raw),
    steps,
    edges: fsm.edges,
    startSteps: fsm.startSteps,
    fsmDegraded: fsm.degraded,
    parseWarnings: [...fsm.warnings, ...warnings],
  };
}

/** Legal transition targets from a step, or the FSM start set when `fromStep` is empty */
export function getLegalTargets(definition: FlowDefinition, fromStep: string): string[] {
  if (!fromStep) return [...definition.startSteps];

  const targets = new Set<string>();
  for (const edge of definition.edges) {
    if (edge.from === fromStep && edge.to !== TERMINAL_STATE) {
      targets.add(edge.to);
    }
  }
  return [...targets];
}

/** Resolve a step name from the parsed definition; null when unknown */
export function getStepName(definition: FlowDefinition, stepId: string): string | null {
  const step = definition.steps.find((s) => s.id === stepId);
  return step && step.name !== '' ? step.name : null;
}

// ─── Rollback Target Resolution ───

const ROLLBACK_REASON_ALIASES: Record<string, string[]> = {
  'Execution problem': ['Execution problem', '执行问题'],
  'Design problem': ['Design problem', '设计问题'],
  'Unreasonable acceptance criteria': ['Unreasonable acceptance criteria', '验收标准不合理'],
};

/**
 * Resolve the rollback target for a review failure reason, per the Spec
 * decision table:
 *
 *   - Execution problem → redo the current step (self-loop; conservative
 *     fallback when the FSM defines no matching self-loop edge).
 *   - Design problem / Unreasonable acceptance criteria → the target of the
 *     matching `Review failed-{reason}` rollback edge; null when the FSM
 *     defines none (caller falls back to the current step).
 */
export function getRollbackTarget(
  definition: FlowDefinition,
  fromStep: string,
  reason: string,
): string | null {
  const aliases = ROLLBACK_REASON_ALIASES[reason] ?? [reason];
  const normalize = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ');

  for (const edge of definition.edges) {
    if (edge.from !== fromStep || !edge.isRollback || !edge.label) continue;
    for (const alias of aliases) {
      if (normalize(edge.label).endsWith(normalize(alias))) {
        return edge.to === TERMINAL_STATE ? null : edge.to;
      }
    }
  }

  if (aliases.includes('Execution problem')) return fromStep;
  return null;
}

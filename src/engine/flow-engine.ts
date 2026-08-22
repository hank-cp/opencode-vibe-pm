import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Task } from '../memory';
import { DuplicateTaskError, MemorySystem } from '../memory';
import { logger } from '../core';
import type { AgentsConfig } from '../core';
import { FlowNotFoundError } from './errors.js';
import { Part } from '@opencode-ai/sdk';
import type { ControlPromptTemplate } from '../i18n';
import { getControlPromptTemplate, i18n } from '../i18n';
import {
  getLegalTargets,
  getRollbackTarget,
  getStepName,
  parseFlowDocument,
  type FlowDefinition,
} from './flow-parser.js';
import { JournalManager } from './journal-manager.js';
import { ReviewAgentManager } from './review-agent-manager.js';
import type { SubsessionClient } from './subsession-client.js';

export interface StartTaskParams {
  sessionId: string;
  flow: string;
  summary: string;
  userRequest: string;
  /** User-re-specified deliverable, overrides the flow document default */
  deliverable?: string;
  /** User-re-specified acceptance standard, overrides the flow document default */
  acceptanceStandard?: string;
}

/** Outcome of a setStep call — carries validation warnings back to the caller */
export interface SetStepResult {
  ok: boolean;
  /** The step the task is now on (present when ok) */
  step?: string;
  /** Resolved step name (present when ok) */
  stepName?: string;
  /** Validation warning (present when the transition was rejected) */
  warning?: string;
  /** Legal transition targets (present when the transition was rejected) */
  legalTargets?: string[];
  /** Degraded-mode notice (present when validation is unavailable but the switch succeeded) */
  notice?: string;
}

/** Outcome of a verifyOutput call — drives the LLM's review/human/rollback flow */
export interface VerifyOutputResult {
  ok: boolean;
  /** Present when the call failed outright (e.g. no active task) */
  error?: string;
  /** Whether a review-agent verification is configured for the current step */
  reviewRequired?: boolean;
  /** Self-check items from the step's Output Checklist (may be empty) */
  selfCheckChecklist?: string[];
  /** Review items from the step's Review Checklist (may be empty) */
  reviewChecklist?: string[];
  /** Review verdict (present when reviewRequired) */
  conclusion?: 'pass' | 'fail' | 'degraded' | 'timeout';
  /** Present when conclusion is "fail" */
  failReason?: string;
  /** Review comments (present when a review ran) */
  feedback?: string;
  /** Input for the main session's next round */
  nextInput?: string;
  /** Rollback target step per the FSM rollback edge (present when fail) */
  rollbackTarget?: string;
  /** Informational notice (legacy flow, degraded mode, no review configured) */
  notice?: string;
}

/** Optional host-environment dependencies enabling review/journal sub-sessions */
export interface FlowEngineDeps {
  /** Narrow sub-session client (created from the OpenCode SDK client) */
  subsessionClient?: SubsessionClient;
  agents?: AgentsConfig;
}

export class FlowEngine {
  private projectDir: string;
  private commandFlowCache: Map<string, string> | null = null;
  private flowDefinitionCache: Map<string, { mtimeMs: number; definition: FlowDefinition }> =
    new Map();
  private promptTemplate: ControlPromptTemplate | null = null;
  private subsessionClient: SubsessionClient | null = null;
  private reviewManager: ReviewAgentManager | null = null;
  private journalManager: JournalManager | null = null;
  private journalMessageWindow: number;

  constructor(
    private memory: MemorySystem,
    projectDir: string,
    deps?: FlowEngineDeps,
  ) {
    this.projectDir = projectDir;
    this.journalMessageWindow = deps?.agents?.journalMessageWindow ?? 20;

    if (deps?.subsessionClient) {
      this.subsessionClient = deps.subsessionClient;
      this.reviewManager = new ReviewAgentManager(this.subsessionClient, {
        timeoutMs: deps.agents?.reviewTimeoutMs,
        framework: deps.agents?.reviewFramework,
      });
      this.journalManager = new JournalManager(
        this.subsessionClient,
        projectDir,
        memory,
        {
          messageWindow: deps.agents?.journalMessageWindow,
          journalDir: deps.agents?.journalDir,
        },
      );
    }
  }

  initLocale(locale: string): void {
    this.promptTemplate = getControlPromptTemplate(locale);
    logger.info(`FlowEngine.initLocale: locale=${locale} resolved=${this.promptTemplate.locale}`);
  }

  async injectFlowControlPrompt(
    sessionId: string,
    flow: string,
    parts: Part[],
    msgId: string,
    msgSid: string,
  ): Promise<void> {
    if (parts.some((p) => p.type === 'text' && this.promptTemplate!.isControlPromptPart(p.text))) {
      logger.info('injectFlowControlPrompt: already injected, skip');
      return;
    }

    const cmdIdx = parts.findIndex(
      (p) => p.type === 'text' && p.text.includes('<auto-slash-command>'),
    );
    parts.splice(cmdIdx >= 0 ? cmdIdx + 1 : parts.length, 0, {
      id: `prt_vp_${sessionId}_${flow}`,
      messageID: msgId,
      sessionID: msgSid,
      type: 'text',
      text: this.buildControlPrompt(flow),
      synthetic: true,
    });
    logger.info(`injectFlowControlPrompt: spliced after cmdIdx=${cmdIdx} parts=${parts.length}`);
  }

  removeControlPrompt(parts: { type: string; text: string }[]): void {
    let removed = 0;
    for (let i = parts.length - 1; i >= 0; i--) {
      if (
        parts[i].type === 'text' &&
        (this.promptTemplate!.isControlPromptPart(parts[i].text) ||
          this.promptTemplate!.isWarningPromptPart(parts[i].text))
      ) {
        parts.splice(i, 1);
        removed++;
      }
    }
    if (removed > 0) logger.info(`removeControlPrompt: removed=${removed}`);
  }

  buildControlPrompt(flowName?: string): string {
    return this.promptTemplate!.buildControlPrompt(flowName);
  }

  injectFlowWarningPrompt(sessionId: string, parts: Part[], msgId: string, msgSid: string): void {
    if (parts.some((p) => p.type === 'text' && this.promptTemplate!.isWarningPromptPart(p.text))) {
      logger.info('injectFlowWarningPrompt: already injected, skip');
      return;
    }

    parts.splice(parts.length, 0, {
      id: `prt_vp_warn_${sessionId}`,
      messageID: msgId,
      sessionID: msgSid,
      type: 'text',
      text: this.promptTemplate!.buildFlowWarningPrompt(),
      synthetic: true,
    });
  }

  async startTask(params: StartTaskParams): Promise<Task> {
    logger.info(
      `FlowEngine.startTask: flow=${params.flow} sessionId=${params.sessionId} summary=${params.summary} userRequestLen=${params.userRequest?.length ?? 0}`,
    );

    if (!this.flowExists(params.flow)) {
      logger.warn(`FlowEngine.startTask: flow ${params.flow} not found`);
      throw new FlowNotFoundError(params.flow);
    }

    const isDup = await this.memory.checkDuplicateUserRequest(params.sessionId, params.userRequest);
    if (isDup) {
      logger.warn(
        `FlowEngine.startTask: duplicate userRequest detected for session ${params.sessionId}`,
      );
      throw new Error(`This task has been started in Session ${params.sessionId}`);
    }

    const existing = await this.memory.getActiveTask(params.sessionId);
    if (existing) {
      logger.warn(
        `FlowEngine.startTask: session ${params.sessionId} already has active task ${existing.flow}`,
      );
      throw new Error(
        `Session ${params.sessionId} already has active task: ${existing.flow}. Close it before starting a new task.`,
      );
    }

    try {
      const task = await this.memory.createTask({
        sessionId: params.sessionId,
        flow: params.flow,
        currentStep: '',
        currentStepName: '',
        startAt: new Date().toISOString(),
        summary: params.summary,
        userRequest: params.userRequest,
        deliverable: params.deliverable,
        acceptanceStandard: params.acceptanceStandard,
      });
      logger.info(`FlowEngine.startTask: task created id=${task.id}`);
      return task;
    } catch (err) {
      logger.error(`FlowEngine.startTask: createTask failed: ${err}`);
      if (err instanceof DuplicateTaskError)
        throw new Error(`Session ${params.sessionId} already has active task.`);
      throw err;
    }
  }

  async setStep(sessionId: string, step: string): Promise<SetStepResult> {
    const task = await this.memory.getActiveTask(sessionId);
    if (!task) throw new Error(`No active task for session ${sessionId}`);

    if (step === task.currentStep) {
      return { ok: true, step };
    }

    const flowName = task.flow;
    const definition = this.loadFlowDefinition(flowName);

    if (definition.isV2 && !definition.fsmDegraded) {
      const legalTargets = getLegalTargets(definition, task.currentStep);
      if (!legalTargets.includes(step)) {
        const t = i18n().tool;
        const warning = task.currentStep
          ? t.setStepInvalidTransition(step, legalTargets)
          : t.setStepInvalidEntry(step, legalTargets);
        logger.warn(
          `setStep: rejected transition ${task.currentStep || '(start)'} → ${step} (flow ${flowName})`,
        );
        return { ok: false, warning, legalTargets };
      }
    }

    const degradedNotice =
      definition.isV2 && definition.fsmDegraded ? i18n().tool.setStepDegradedNoValidation : undefined;

    const oldStep = task.currentStep;
    const stepName = getStepName(definition, step) ?? this.tryParseStepName(flowName, step) ?? step;
    const now = Date.now();

    await this.memory.updateStep(task.id, step, stepName);

    if (oldStep) {
      await this.memory.recordStepExit(sessionId, oldStep);
    }

    // Persist step transition record
    await this.memory.appendStepTransition(task.id, {
      fromStep: oldStep ?? '',
      toStep: step,
      at: new Date(now).toISOString(),
    });

    await this.memory.incrementStepCount(sessionId, flowName, step, stepName, task.summary);
    logger.info(`setStep: ${oldStep} → ${step} (${stepName})`);

    this.journalManager?.scheduleEntry({
      taskId: task.id,
      taskSummary: task.summary,
      taskStartAt: task.startAt,
      flow: task.flow,
      sessionId,
      fromStep: oldStep,
      toStep: step,
      toStepName: stepName,
      transitionAt: new Date(now).toISOString(),
    });

    return { ok: true, step, stepName, notice: degradedNotice };
  }

  async verifyOutput(sessionId: string): Promise<VerifyOutputResult> {
    const task = await this.memory.getActiveTask(sessionId);
    if (!task) {
      return { ok: false, error: i18n().tool.verifyNoTask };
    }

    const definition = this.loadFlowDefinition(task.flow);

    if (!definition.isV2) {
      return {
        ok: true,
        reviewRequired: false,
        selfCheckChecklist: [],
        reviewChecklist: [],
        notice: i18n().tool.verifyNoReviewLegacy,
      };
    }

    const step = definition.steps.find((s) => s.id === task.currentStep);
    if (!step || step.outputReview.length === 0) {
      return {
        ok: true,
        reviewRequired: false,
        selfCheckChecklist: [],
        reviewChecklist: [],
        notice: i18n().tool.verifyNoReview,
      };
    }

    const reviewRequired = step.outputReview.includes('review-agent');
    const selfCheckChecklist = step.outputChecklist;
    const reviewChecklist = step.reviewChecklist;
    const selfCheckWithoutChecklist =
      step.outputReview.includes('self-check') && selfCheckChecklist.length === 0;

    if (!reviewRequired) {
      return {
        ok: true,
        reviewRequired: false,
        selfCheckChecklist,
        reviewChecklist,
        notice: this.buildNonAgentReviewHint(step.outputReview, selfCheckWithoutChecklist),
      };
    }

    if (!this.reviewManager || !this.subsessionClient) {
      return {
        ok: true,
        reviewRequired: true,
        selfCheckChecklist,
        reviewChecklist,
        conclusion: 'degraded',
        notice: selfCheckWithoutChecklist
          ? `${i18n().tool.verifyDegradedNoClient} ${i18n().tool.verifySelfCheckNoChecklist}`
          : i18n().tool.verifyDegradedNoClient,
      };
    }

    let excerpt = '';
    try {
      excerpt = await this.subsessionClient.fetchRecentMessages(
        sessionId,
        this.journalMessageWindow,
      );
    } catch (err) {
      logger.warn(`verifyOutput: fetch excerpt failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    const result = await this.reviewManager.startReview({
      parentSessionId: sessionId,
      taskId: task.id,
      taskSummary: task.summary,
      flow: task.flow,
      stepId: step.id,
      stepName: step.name,
      acceptanceStandard: definition.acceptanceStandard,
      reviewChecklist: step.reviewChecklist,
      conversationExcerpt: excerpt,
    });

    if (result.conclusion === 'pass' || result.conclusion === 'fail') {
      await this.memory.recordReview({
        taskId: task.id,
        sessionId,
        flow: task.flow,
        step: step.id,
        conclusion: result.conclusion,
        failReason: result.failReason,
        feedback: result.feedback,
      });
    }

    let rollbackTarget: string | undefined;
    if (result.conclusion === 'fail' && result.failReason) {
      rollbackTarget =
        getRollbackTarget(definition, step.id, result.failReason) ?? step.id;
    }

    const t = i18n().tool;
    const nextInput =
      result.conclusion === 'degraded'
        ? t.verifyDegraded
        : result.conclusion === 'timeout'
          ? t.verifyTimeout
          : result.nextInput;

    return {
      ok: true,
      reviewRequired: true,
      selfCheckChecklist,
      reviewChecklist,
      conclusion: result.conclusion,
      failReason: result.failReason,
      feedback: result.feedback,
      nextInput,
      rollbackTarget,
      notice: selfCheckWithoutChecklist ? t.verifySelfCheckNoChecklist : undefined,
    };
  }

  private buildNonAgentReviewHint(reviewModes: string[], selfCheckWithoutChecklist: boolean): string {
    const t = i18n().tool;
    const modes = reviewModes
      .map((m) => {
        if (m === 'self-check') return t.verifyModeSelfCheck;
        if (m === 'human') return t.verifyModeHuman;
        return m;
      })
      .join(' + ');
    const base = t.verifyNonAgentHint(modes);
    return selfCheckWithoutChecklist ? `${base} ${t.verifySelfCheckNoChecklist}` : base;
  }

  async closeTask(sessionId: string): Promise<Task | null> {
    const task = await this.memory.getActiveTask(sessionId);
    if (!task) return null;

    if (task.currentStep) {
      await this.memory.recordStepExit(sessionId, task.currentStep);
    }

    await this.memory.closeTask(task.id);
    return { ...task, closed: true };
  }

  resolveFlowFromCommand(command: string): string | null {
    const map = this.buildCommandFlowMap();
    return map.get(command.replace(/^\//, '')) ?? null;
  }

  clearCommandFlowCache(): void {
    this.commandFlowCache = null;
  }

  private flowExists(flowName: string): boolean {
    return this.resolveFlowFilePath(flowName) !== null;
  }

  private resolveFlowFilePath(flowName: string): string | null {
    const d = path.join(this.projectDir, 'docs', 'flow');
    for (const fp of [path.join(d, `flow-${flowName}.md`), path.join(d, `${flowName}.md`)]) {
      if (fs.existsSync(fp)) return fp;
    }
    return null;
  }

  private loadFlowDefinition(flowName: string): FlowDefinition {
    const fp = this.resolveFlowFilePath(flowName);
    if (!fp) return parseFlowDocument('', flowName);

    let mtimeMs = 0;
    let raw = '';
    try {
      mtimeMs = fs.statSync(fp).mtimeMs;
      raw = fs.readFileSync(fp, 'utf-8');
    } catch (err) {
      logger.warn(`FlowEngine.loadFlowDefinition: read failed for ${fp}: ${err}`);
      return parseFlowDocument('', flowName);
    }

    const cached = this.flowDefinitionCache.get(flowName);
    if (cached && cached.mtimeMs === mtimeMs) return cached.definition;

    const definition = parseFlowDocument(raw, flowName);
    this.flowDefinitionCache.set(flowName, { mtimeMs, definition });
    for (const warning of definition.parseWarnings) {
      logger.warn(`FlowParser(${flowName}): ${warning}`);
    }
    return definition;
  }

  private tryParseStepName(flowName: string, stepId: string): string | null {
    const d = path.join(this.projectDir, 'docs', 'flow');
    for (const fp of [path.join(d, `flow-${flowName}.md`), path.join(d, `${flowName}.md`)]) {
      if (!fs.existsSync(fp)) continue;
      try {
        const raw = fs.readFileSync(fp, 'utf-8');
        const m = raw.match(new RegExp(`###\\s+${stepId}[:|：]\\s*(.+)`, 'i'));
        if (m) {
          const cleaned = m[1]
            .trim()
            .replace(/\[.*?\]|⚠️\s*/g, '')
            .trim();
          return cleaned || null;
        }
      } catch {
        /* ignore parse errors from malformed flow files */
      }
    }
    return null;
  }

  private buildCommandFlowMap(): Map<string, string> {
    if (this.commandFlowCache) return this.commandFlowCache;
    const map = new Map<string, string>();
    const d = path.join(this.projectDir, 'docs', 'flow');
    if (!fs.existsSync(d)) {
      this.commandFlowCache = map;
      return map;
    }
    for (const file of fs.readdirSync(d)) {
      if (!file.endsWith('.md')) continue;
      try {
        const raw = fs.readFileSync(path.join(d, file), 'utf-8');
        const m = raw.match(/\*\*Command\*\*:\s*`?(.+?)`?\s*$/m);
        if (m) {
          const cmd = m[1].trim().replace(/^\//, '');
          const name = file.replace(/^flow-/, '').replace(/\.md$/, '');
          map.set(cmd, name);
        }
      } catch {
        /* ignore parse errors from malformed flow files */
      }
    }
    this.commandFlowCache = map;
    return map;
  }
}

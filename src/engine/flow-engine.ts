import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Task } from '../memory';
import { DuplicateTaskError, MemorySystem } from '../memory';
import { logger } from '../core';
import { FlowNotFoundError } from './errors.js';
import { Part } from '@opencode-ai/sdk';
import type { ControlPromptTemplate } from '../i18n';
import { getControlPromptTemplate } from '../i18n';

export interface StartTaskParams {
  sessionId: string;
  flow: string;
  summary: string;
  userRequest: string;
}

export class FlowEngine {
  private projectDir: string;
  private commandFlowCache: Map<string, string> | null = null;
  private promptTemplate: ControlPromptTemplate | null = null;

  constructor(
    private memory: MemorySystem,
    projectDir: string,
  ) {
    this.projectDir = projectDir;
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

  async setStep(sessionId: string, step: string): Promise<void> {
    const task = await this.memory.getActiveTask(sessionId);
    if (!task) throw new Error(`No active task for session ${sessionId}`);

    if (step === task.currentStep) return;

    const oldStep = task.currentStep;
    const flowName = task.flow;
    const stepName = this.tryParseStepName(flowName, step) ?? step;
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
    const d = path.join(this.projectDir, 'docs', 'flow');
    return [path.join(d, `flow-${flowName}.md`), path.join(d, `${flowName}.md`)].some((c) =>
      fs.existsSync(c),
    );
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

/**
 * Flow Engine — vibe-pm 核心业务层
 *
 * Flow 文档解析、前缀固定 + 尾部变量上下文注入、消息裁剪、步骤流转协调。
 * 使用 @opencode-ai/plugin SDK 的 hook 类型。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { get_encoding } from "tiktoken";
import { MemorySystem } from "../memory/index.js";
import { DuplicateTaskError } from "../memory/errors.js";
import { logger } from "../core/logger.js";
import type { PluginConfig } from "../core/types.js";
import type { Task } from "../memory/types.js";
import type {
  FlowDefinition,
  StepDefinition,
  InjectedContext,
  InjectionPlan,
  StepTaggedMessage,
  DepthAssignedMessage,
  StepTransition,
  StartTaskParams,
} from "./types.js";
import {
  DuplicateActiveTaskError,
  FlowNotFoundError,
  FlowParseError,
} from "./errors.js";

// ─── SDK Hook 运行时类型 ───

interface SystemTransformOutput {
  system: string[];
  [key: string]: unknown;
}

interface MessagesTransformOutput {
  messages: Array<{
    role?: string;
    content?: string | null;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

interface ChatMessageInput {
  sessionID?: string;
  [key: string]: unknown;
}

// ─── Token 估算器 ───

const tokenizer = get_encoding("cl100k_base");

function estimateTokens(text: string): number {
  return tokenizer.encode(text).length;
}

// ─── 注入指纹去重 ───

const lastInjectedFingerprint = new Map<string, string>();

// ─── 步骤转换时间线 ───

const stepTransitions = new Map<string, StepTransition[]>();

function computeFingerprint(
  flow: string,
  step: string,
  regulations: string[],
): string {
  return crypto
    .createHash("md5")
    .update(`${flow}:${step}:${regulations.join(",")}`)
    .digest("hex");
}

function shouldInject(
  sessionId: string,
  flow: string,
  step: string,
  regulations: string[],
): boolean {
  const fp = computeFingerprint(flow, step, regulations);
  if (lastInjectedFingerprint.get(sessionId) === fp) return false;
  lastInjectedFingerprint.set(sessionId, fp);
  return true;
}

// ─── FlowEngine ───

export class FlowEngine {
  private projectDir: string;
  private config: PluginConfig;
  /** 当前活跃的 session ID，由 onMessage 更新 */
  currentSessionId: string | null = null;
  /** 待注入的 flow：command.execute.before 设置 → injectContext 消费 */
  private pendingFlowInjects = new Map<string, string>();

  constructor(
    private memory: MemorySystem,
    projectDir: string,
    config: PluginConfig,
  ) {
    this.projectDir = projectDir;
    this.config = config;
  }

  // ═══════════════════════════════════════════
  // Hook 回调
  // ═══════════════════════════════════════════

  async onMessage(input: ChatMessageInput): Promise<void> {
    const sessionId = input.sessionID;
    if (!sessionId) return;
    this.currentSessionId = sessionId;
  }

  async injectContext(
    input: { sessionID?: string; [key: string]: unknown },
    output: SystemTransformOutput,
  ): Promise<void> {
    const sessionId = input.sessionID;
    if (!sessionId) return;

    const task = await this.memory.getActiveTask(sessionId);
    if (!task) {
      this.injectFlowFromPending(sessionId, output);
      return;
    }

    const flowDef = await this.parseFlow(task.flow);
    const currentStep = flowDef.steps.find((s) => s.id === task.currentStep);
    if (!currentStep) return;

    // 注入指纹去重（仅步骤动态部分参与）
    const regNames = currentStep.regulations;
    if (!shouldInject(sessionId, task.flow, task.currentStep, regNames)) {
      return;
    }

    // 读取固定前缀内容
    const constitution = this.readRegulation("constitution.md");
    const flowRaw = await this.readFlowContent(task.flow);
    const regulations = this.readRegulations(regNames);

    // 构建前缀固定 + 尾部变量注入
    const ctx = this.buildInjectionContext(
      flowDef,
      task,
      constitution,
      flowRaw,
      regulations,
    );

    // 前置注入到 system prompt：固定前缀 → 步骤动态 → 原始 system prompt
    const parts: string[] = [];
    parts.push(ctx.staticPrefix, ctx.stepDynamic);
    if (output.system.length > 0) {
      parts.push(...output.system);
    }
    output.system = parts;

    // 调试日志
    if (this.config.debug?.logFullRequest) {
      logger.debug("=== vibe-pm LLM Request Context ===");
      logger.debug(`Session: ${sessionId}`);
      logger.debug(`Flow: ${task.flow}, Step: ${task.currentStep}`);
      logger.debug("--- System Prompt ---");
      logger.debug(output.system.join("\n"));
      logger.debug("================================");
    }
  }

  async transformMessages(
    input: { sessionID?: string; [key: string]: unknown },
    output: MessagesTransformOutput,
  ): Promise<void> {
    const sessionId = input.sessionID;
    if (!sessionId) return;

    const messages = output.messages;
    if (!Array.isArray(messages) || messages.length === 0) return;

    // 注入 Flow 引用到用户消息中（用户级权威，非系统级建议）
    this.injectFlowRefIntoUserMessage(sessionId, output);

    const task = await this.memory.getActiveTask(sessionId);
    if (!task) return;

    // 裁剪未启用
    if (!this.config.contextInjection.pruneIrrelevant) return;

    const maxTokens = this.config.contextInjection.maxStepTokens;
    if (maxTokens <= 0) return; // 不限制

    // 惰性裁剪：仅当超过 80% 阈值
    const currentTokens = estimateTokens(JSON.stringify(messages));
    if (currentTokens < maxTokens * 0.8) return;

    // 消息裁剪（传入 sessionId 用于步骤归属）
    const pruned = this.pruneMessages(
      messages as Array<{ role: string; content: string | null }>,
      sessionId,
    );
    output.messages = pruned as MessagesTransformOutput["messages"];
  }

  async onSessionIdle(_sessionId: string): Promise<void> {
    // 当前阶段无操作
  }

  // ═══════════════════════════════════════════
  // Flow 管理
  // ═══════════════════════════════════════════

  async parseFlow(flowName: string): Promise<FlowDefinition> {
    const flowDir = path.join(this.projectDir, "docs", "flow");
    const candidates = [
      path.join(flowDir, `${flowName}.md`),
      path.join(flowDir, `[flow]${flowName}.md`),
    ];

    let filePath = "";
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        filePath = c;
        break;
      }
    }

    if (!filePath) {
      throw new FlowNotFoundError(flowName);
    }

    const raw = fs.readFileSync(filePath, "utf-8");
    return this.parseFlowMarkdown(flowName, raw);
  }

  async readFlowContent(flowName: string): Promise<string> {
    const flowDir = path.join(this.projectDir, "docs", "flow");
    const candidates = [
      path.join(flowDir, `${flowName}.md`),
      path.join(flowDir, `[flow]${flowName}.md`),
    ];

    for (const c of candidates) {
      if (fs.existsSync(c)) {
        return fs.readFileSync(c, "utf-8");
      }
    }
    throw new FlowNotFoundError(flowName);
  }

  private readFlowContentSync(flowName: string): string {
    const flowDir = path.join(this.projectDir, "docs", "flow");
    const candidates = [
      path.join(flowDir, `${flowName}.md`),
      path.join(flowDir, `[flow]${flowName}.md`),
    ];

    for (const c of candidates) {
      if (fs.existsSync(c)) {
        return fs.readFileSync(c, "utf-8");
      }
    }
    throw new FlowNotFoundError(flowName);
  }

  async listFlows(): Promise<string[]> {
    const flowDir = path.join(this.projectDir, "docs", "flow");
    if (!fs.existsSync(flowDir)) return [];

    return fs
      .readdirSync(flowDir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.replace(/^\[flow\]/, "").replace(/\.md$/, ""));
  }

  // ═══════════════════════════════════════════
  // 任务操作
  // ═══════════════════════════════════════════

  async startTask(params: StartTaskParams): Promise<Task> {
    // 检查是否已有活跃任务
    const existing = await this.memory.getActiveTask(params.sessionId);
    if (existing) {
      throw new DuplicateActiveTaskError({
        flow: existing.flow,
        currentStep: existing.currentStep,
        currentStepName: existing.currentStepName,
        summary: existing.summary,
        startAt: existing.startAt,
      });
    }

    // 解析 Flow 获取第一个步骤
    const flowDef = await this.parseFlow(params.flow);
    const firstStep = flowDef.steps[0];
    if (!firstStep) {
      throw new FlowParseError(params.flow, "Flow has no steps defined");
    }

    // 记录初始步骤转换
    this.recordStepTransition(params.sessionId, firstStep.id, firstStep.name);

    // 记录初始步骤进入指标
    await this.memory.recordStepEntry(
      params.sessionId,
      params.flow,
      firstStep.id,
      firstStep.name,
      0,
      0,
    );

    // 创建 Task
    try {
      return await this.memory.createTask({
        sessionId: params.sessionId,
        flow: params.flow,
        currentStep: firstStep.id,
        currentStepName: firstStep.name,
        startAt: new Date().toISOString(),
        summary: params.summary,
        specRef: params.specRef,
        planRef: params.planRef,
      });
    } catch (err) {
      if (err instanceof DuplicateTaskError) {
        const existing = await this.memory.getTask(params.sessionId);
        if (existing) {
          throw new DuplicateActiveTaskError({
            flow: existing.flow,
            currentStep: existing.currentStep,
            currentStepName: existing.currentStepName,
            summary: existing.summary,
            startAt: existing.startAt,
          });
        }
      }
      throw err;
    }
  }

  async setStep(sessionId: string, stepId: string): Promise<void> {
    const task = await this.memory.getActiveTask(sessionId);
    if (!task) return;

    const flowDef = await this.parseFlow(task.flow);
    const step = flowDef.steps.find((s) => s.id === stepId);
    if (!step) return;

    const prevStep = task.currentStep;
    const prevStepName = task.currentStepName;

    // 记录步骤转换时间线
    this.recordStepTransition(sessionId, stepId, step.name);

    // 记录上一步的退出指标
    if (prevStep !== stepId) {
      await this.memory.recordStepExit(sessionId, prevStep, 0, 0);
    }

    // 记录新步骤进入指标
    await this.memory.recordStepEntry(
      sessionId,
      task.flow,
      stepId,
      step.name,
      0,
      0,
    );

    await this.memory.updateStep(sessionId, step.id, step.name);
  }

  async getCurrentStep(sessionId: string): Promise<StepDefinition | null> {
    const task = await this.memory.getActiveTask(sessionId);
    if (!task) return null;

    const flowDef = await this.parseFlow(task.flow);
    return flowDef.steps.find((s) => s.id === task.currentStep) ?? null;
  }

  /** 清除指定 session 的注入指纹，强制下次重新注入 */
  clearInjectionFingerprint(sessionId: string): void {
    lastInjectedFingerprint.delete(sessionId);
  }

  /** 关闭当前任务并返回被关闭的 Task */
  async closeTask(sessionId: string): Promise<Task | null> {
    const task = await this.memory.getActiveTask(sessionId);
    if (!task) return null;

    await this.memory.closeTask(sessionId);
    return { ...task, closed: true };
  }

  // ─── 步骤转换时间线 ───

  private recordStepTransition(
    sessionId: string,
    stepId: string,
    stepName: string,
  ): void {
    const transitions = stepTransitions.get(sessionId) ?? [];
    transitions.push({
      stepId,
      stepName,
      timestamp: Date.now(),
    });
    stepTransitions.set(sessionId, transitions);
  }

  // ═══════════════════════════════════════════
  // Flow 解析（内嵌 Markdown 解析器）
  // ═══════════════════════════════════════════

  private parseFlowMarkdown(name: string, raw: string): FlowDefinition {
    // 提取标题
    const titleMatch = raw.match(/^#\s+Flow:\s*(.+)/m);
    const flowName = titleMatch?.[1]?.trim() ?? name;

    // 提取 Command
    const cmdMatch = raw.match(/\*\*Command\*\*:\s*`(.+?)`/);
    const command = cmdMatch?.[1]?.trim() ?? "";

    // 提取 Scenario
    const scenarioMatch = raw.match(/##\s+适用场景\s*\n+(.+?)(?=\n##|\n---)/s);
    const scenario = scenarioMatch?.[1]?.trim() ?? "";

    // 提取输入要求表格
    const inputReqs = this.parseInputRequirements(raw);

    // 提取交付清单
    const deliverables = this.parseDeliverables(raw);

    // 提取 Mermaid FSM
    const mermaidMatch = raw.match(/```mermaid\n([\s\S]*?)```/);
    const fsmDiagram = mermaidMatch?.[1]?.trim() ?? "";

    // 提取步骤
    const steps = this.parseSteps(raw);

    if (steps.length === 0) {
      throw new FlowParseError(name, "No steps found in Flow document");
    }

    return {
      name: flowName,
      command,
      scenario,
      inputRequirements: inputReqs,
      defaultDeliverables: deliverables,
      fsmDiagram,
      steps,
    };
  }

  private parseInputRequirements(raw: string) {
    const tableMatch = raw.match(
      /##\s+输入要求\s*\n.*?\n((?:\|.+\|[\s\S]*?))(?=\n##|\n---|$)/,
    );
    if (!tableMatch) return [];
    const lines = tableMatch[1].split("\n").filter((l) => l.includes("|"));
    return lines.slice(1).map((line) => {
      const cols = line
        .split("|")
        .map((c) => c.trim())
        .filter(Boolean);
      return {
        name: cols[0] ?? "",
        required: cols[1]?.toLowerCase() === "是",
        description: cols[2] ?? "",
      };
    });
  }

  private parseDeliverables(raw: string): string[] {
    const section = raw.match(
      /##\s+(?:默认)?交付清单\s*\n((?:[\s\S]*?))(?=\n##|\n---|$)/,
    );
    if (!section) return [];
    return section[1]
      .split("\n")
      .filter((l) => l.trim().startsWith("-"))
      .map((l) => l.replace(/^-\s*/, "").trim());
  }

  private parseSteps(raw: string): StepDefinition[] {
    const steps: StepDefinition[] = [];

    // 匹配所有步骤章节 #### S1: xxx 或 ### S1: xxx
    const stepRegex = /###\s+(S\d+):\s*(.+)/g;
    const matches = [...raw.matchAll(stepRegex)];

    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      const stepId = match[1];
      const stepName = match[2].trim();

      // 提取该步骤的原始内容（到下一个步骤或文档结束）
      const startIdx = (match.index ?? 0) + match[0].length;
      const nextIdx =
        i + 1 < matches.length ? matches[i + 1].index : raw.length;
      const section = raw.slice(startIdx, nextIdx!);

      const step = this.parseOneStep(stepId, stepName, section);
      steps.push(step);
    }

    return steps;
  }

  private parseOneStep(
    id: string,
    name: string,
    section: string,
  ): StepDefinition {
    // 提取目标
    const goalMatch = section.match(/\*\*目标\*\*[：:]\s*(.+)/);
    const goal = goalMatch?.[1]?.trim() ?? "";

    // 提取执行 Agent
    const agentMatch = section.match(/\*\*执行 Agent\*\*[：:]\s*(.+)/);
    const agent = agentMatch?.[1]?.trim() ?? "";

    // 提取引用 Regulation
    const regMatch = section.match(/\*\*引用 Regulation\*\*[：:]\s*(.+)/);
    const regulations =
      regMatch?.[1]
        ?.split(/[,，]/)
        .map((r) => r.trim())
        .filter((r) => r !== "—" && r !== "") ?? [];

    // 提取编号指令
    const instructions: string[] = [];
    const lines = section.split("\n");
    let inInstructions = false;
    for (const line of lines) {
      if (/^\d+\.\s/.test(line)) {
        inInstructions = true;
        instructions.push(line.replace(/^\d+\.\s*/, "").trim());
      } else if (inInstructions && /^\*\*完成后\*\*/.test(line)) {
        break;
      } else if (inInstructions && line.trim() === "") {
        // 允许空行在指令之间
        continue;
      } else if (
        inInstructions &&
        !/^\d+\.\s/.test(line) &&
        line.trim() !== ""
      ) {
        inInstructions = false;
      }
    }

    // 提取完成后
    const onCompleteMatch = section.match(/\*\*完成后\*\*[：:]\s*(.+)/);
    const onComplete = onCompleteMatch?.[1]?.trim() ?? "";

    // Human-in-loop 检测
    const humanInLoop =
      section.includes("⚠️") || section.includes("需要用户介入");

    return {
      id,
      name: name.replace(/\[Human-in-loop\]\s*/i, ""),
      goal,
      agent,
      regulations,
      instructions,
      humanInLoop,
      onComplete,
    };
  }

  // ═══════════════════════════════════════════
  // 上下文注入
  // ═══════════════════════════════════════════

  private readRegulation(filename: string): string {
    const regPath = path.join(
      this.projectDir,
      "docs",
      "regulation",
      filename,
    );
    if (fs.existsSync(regPath)) {
      return fs.readFileSync(regPath, "utf-8");
    }
    return `[Regulation ${filename} not found]`;
  }

  private readRegulations(names: string[]): string[] {
    return names.map((n) => this.readRegulation(n));
  }

  private buildInjectionContext(
    flowDef: FlowDefinition,
    task: Task,
    constitution: string,
    flowRawContent: string,
    regulations: string[],
  ): InjectedContext {
    // 固定前缀（缓存稳定，整个流程中不变）
    const staticPrefix = [
      `<constitution>\n${constitution}\n</constitution>`,
      `\n<flow-document flow="${task.flow}">\n${flowRawContent}\n</flow-document>`,
      `\n<flow-control>\n${this.buildStaticControlPrompt()}\n</flow-control>`,
    ].join("");

    // 步骤动态（尾部可变，步骤推进时更新）
    const stepDynamic = this.buildStepDynamic(flowDef, task, regulations);

    return { staticPrefix, stepDynamic, regulations };
  }

  private buildStaticControlPrompt(): string {
    return [
      "## ⚠️ FLOW MANDATE — OVERRIDES ALL OTHER BEHAVIORS",
      "You are executing a predefined workflow. Step sequence is MANDATORY.",
      "",
      "**NEVER** skip ahead to code implementation before reaching the implementation step.",
      "**NEVER** bypass Human-in-loop steps. They are MANDATORY gates.",
      "**NEVER** skip from analysis/research directly to coding — follow the step sequence.",
      "Use pm_task_set_step to advance ONLY after completing the current step.",
      "Human-in-loop steps require question/confirm tools. Ask ONE question at a time.",
      "The full Flow document above defines all steps. Follow it strictly.",
    ].join("\n");
  }

  private buildStepDynamic(
    flowDef: FlowDefinition,
    task: Task,
    regulations: string[],
  ): string {
    const parts: string[] = [];
    const currentStep = flowDef.steps.find((s) => s.id === task.currentStep);

    // 当前步骤状态
    parts.push(
      `\n<current-step id="${task.currentStep}" name="${task.currentStepName}">`,
    );
    parts.push(`\n**当前步骤**: ${task.currentStep} — ${task.currentStepName}`);
    if (currentStep) {
      parts.push(`\n**目标**: ${currentStep.goal}`);
      if (currentStep.humanInLoop) {
        parts.push(
          "\n⛔ **本步骤是 Human-in-loop！** 使用 question/confirm 工具。每次只问 1 个问题。",
        );
      }
      parts.push(`\n**完成后**: ${currentStep.onComplete}`);
    }
    parts.push("\n</current-step>");

    // Task 状态
    parts.push("\n<task-state>");
    parts.push(`\n- Session ID: ${task.sessionId}`);
    parts.push(`\n- Flow: ${task.flow}`);
    parts.push(`\n- 任务摘要: ${task.summary}`);
    parts.push(`\n- 开始时间: ${task.startAt}`);
    if (task.specRef) parts.push(`\n- Spec 文档: ${task.specRef}`);
    if (task.planRef) parts.push(`\n- 计划文档: ${task.planRef}`);
    parts.push("\n</task-state>");

    // Step 指定的 Regulation（条件注入）
    for (const reg of regulations) {
      parts.push(`\n<regulation>\n${reg}\n</regulation>`);
    }

    return parts.join("");
  }

  // ═══════════════════════════════════════════
  // 命令驱动的自动任务创建（Hook 驱动，非 Tool 驱动）
  // ═══════════════════════════════════════════

  private commandFlowCache: Map<string, string> | null = null;

  /**
   * 从已安装的 Flow 文档中扫描 Command → Flow 映射。
   * 结果缓存在内存中，仅在插件的 Flow 文档发生变更时需 clear 缓存。
   */
  private buildCommandFlowMap(): Map<string, string> {
    if (this.commandFlowCache) return this.commandFlowCache;

    const map = new Map<string, string>();
    const flowDir = path.join(this.projectDir, "docs", "flow");
    if (!fs.existsSync(flowDir)) {
      this.commandFlowCache = map;
      return map;
    }

    for (const file of fs.readdirSync(flowDir)) {
      if (!file.endsWith(".md")) continue;
      try {
        const raw = fs.readFileSync(path.join(flowDir, file), "utf-8");
        const cmdMatch = raw.match(/\*\*Command\*\*:\s*`?(.+?)`?\s*$/m);
        if (cmdMatch) {
          const cmd = cmdMatch[1].trim().replace(/^\//, "");
          const flowName = file.replace(/^\[flow\]/, "").replace(/\.md$/, "");
          map.set(cmd, flowName);
        }
      } catch {
        // 文件读取失败 → 跳过
      }
    }

    this.commandFlowCache = map;
    return map;
  }

  clearCommandFlowCache(): void {
    this.commandFlowCache = null;
  }

  /**
   * 根据 slash 命令名解析对应的 Flow 名称。
   * 如 "pm-bug-fix" → "bug-fix"，"pm-spec-driven-dev" → "spec-driven-dev"。
   */
  resolveFlowFromCommand(command: string): string | null {
    const map = this.buildCommandFlowMap();
    // Strip leading / to match buildCommandFlowMap's key format
    const cleanCommand = command.replace(/^\//, "");
    return map.get(cleanCommand) ?? null;
  }

  /**
   * 当用户触发 /pm-* 命令时，自动创建任务（由 command.execute.before hook 调用）。
   * 如果已有活跃任务则跳过（不报错，保持现有任务）。
   */
  async autoStartTaskFromCommand(
    sessionId: string,
    command: string,
    args: string,
  ): Promise<string | null> {
    const flowName = this.resolveFlowFromCommand(command);
    if (!flowName) {
      logger.warn(`autoStartTaskFromCommand: no flow for command "${command}"`);
      return null;
    }

    // 无论任务创建是否成功，都记录 pending，确保 injectContext 能注入 flow 上下文
    this.pendingFlowInjects.set(sessionId, flowName);

    const existing = await this.memory.getActiveTask(sessionId);
    if (existing) {
      logger.info(
        `autoStartTaskFromCommand: session ${sessionId} already has active task, skipping`,
      );
      return null;
    }

    try {
      const task = await this.startTask({
        sessionId,
        flow: flowName,
        summary: args || `${command} 任务`,
        specRef: undefined,
        planRef: undefined,
      });
      logger.info(
        `autoStartTaskFromCommand: created task for "${command}" → flow "${flowName}", step ${task.currentStep}`,
      );
      return task.currentStep;
    } catch (err) {
      logger.error(`autoStartTaskFromCommand failed for ${command}`, {
        error: String(err),
      });
      return null;
    }
  }

  closeInactiveTask(sessionId: string): Promise<void> {
    return this.memory.closeTask(sessionId);
  }

  /**
   * 将 flow 文档内容注入到 command.execute.before 的 output.parts 中。
   * 这是对「system.transform 先于 command.execute.before 触发」的补偿：
   * 首轮 LLM 调用时，system.transform 中的 injectContext 还拿不到任务和 pendingFlowInjects，
   * 因此通过 command output parts 携带 flow 内容，确保 LLM 能获取流程上下文。
   */
  async injectFlowToCommandParts(
    sessionId: string,
    command: string,
    output: { parts: unknown[] },
  ): Promise<void> {
    const flowName = this.resolveFlowFromCommand(command);
    if (!flowName) return;

    try {
      const flowRaw = await this.readFlowContent(flowName);
      if (!flowRaw) return;

      output.parts.push({
        type: "text",
        text: `\n<flow-document flow="${flowName}">\n${flowRaw}\n</flow-document>`,
      });
    } catch {
      // Flow 文档不存在或读取失败 → 不注入
    }
  }

  private injectFlowFromPending(
    sessionId: string,
    output: SystemTransformOutput,
  ): void {
    const flowName = this.pendingFlowInjects.get(sessionId);
    if (!flowName) return;

    let flowDef: FlowDefinition;
    let flowRaw: string;
    try {
      flowDef = this.parseFlowSync(flowName);
      flowRaw = this.readFlowContentSync(flowName);
    } catch {
      this.pendingFlowInjects.delete(sessionId);
      return;
    }

    const firstStep = flowDef.steps[0];
    if (!firstStep) {
      this.pendingFlowInjects.delete(sessionId);
      return;
    }

    const constitution = this.readRegulation("constitution.md");

    // 固定前缀：Constitution + Flow 全文 + 控制 Prompt（静态）
    const staticPrefixParts: string[] = [];
    staticPrefixParts.push(
      `<constitution>\n${constitution}\n</constitution>`,
    );
    staticPrefixParts.push(
      `\n<flow-document flow="${flowName}">\n${flowRaw}\n</flow-document>`,
    );
    staticPrefixParts.push(
      `\n<flow-control>\n${this.buildStaticControlPrompt()}\n</flow-control>`,
    );

    // 步骤动态：前 N 步预览（默认 2 步）
    const maxPreviewSteps = 2;
    const previewSteps = flowDef.steps.slice(0, maxPreviewSteps);
    const stepDynamicParts: string[] = [];

    for (const step of previewSteps) {
      stepDynamicParts.push(`\n<step id="${step.id}" name="${step.name}">`);
      stepDynamicParts.push(`\n**目标**: ${step.goal}`);
      stepDynamicParts.push(`\n**推荐 Agent**: ${step.agent}`);
      stepDynamicParts.push("\n---");
      for (const [i, instr] of step.instructions.entries()) {
        stepDynamicParts.push(`\n${i + 1}. ${instr}`);
      }
      if (step.humanInLoop) {
        stepDynamicParts.push(
          "\n\n⚠️⚠️⚠️ **本步骤需要用户介入！** 你必须使用 question / confirm 阻塞式工具向用户提问。每次只问 1 个问题，收到回复前不得继续。⚠️⚠️⚠️",
        );
      }
      stepDynamicParts.push(`\n**完成后**: ${step.onComplete}`);
      stepDynamicParts.push(`\n</step>`);
    }

    stepDynamicParts.push("\n<step-reminder>");
    stepDynamicParts.push("\n**当前步骤是 S1。严格按 Flow 文档中的步骤顺序执行。**");
    stepDynamicParts.push(
      "\nAdvance steps using pm_task_set_step only after completing the current step.",
    );
    stepDynamicParts.push("\n</step-reminder>");

    // 前置注入到 system prompt：固定前缀 → 步骤动态 → 原始 system prompt
    const parts: string[] = [];
    parts.push(
      staticPrefixParts.join(""),
      stepDynamicParts.join(""),
    );
    if (output.system.length > 0) {
      parts.push(...output.system);
    }
    output.system = parts;

    // 不删除 pending，留给 transformMessages 中的 injectFlowRefIntoUserMessage 消费
  }

  /** parseFlow 的同步版本，用于 hook 中无需 await 的场景 */
  private parseFlowSync(flowName: string): FlowDefinition {
    const flowDir = path.join(this.projectDir, "docs", "flow");
    const candidates = [
      path.join(flowDir, `${flowName}.md`),
      path.join(flowDir, `[flow]${flowName}.md`),
    ];

    let filePath = "";
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        filePath = c;
        break;
      }
    }

    if (!filePath) {
      throw new FlowNotFoundError(flowName);
    }

    const raw = fs.readFileSync(filePath, "utf-8");
    return this.parseFlowMarkdown(flowName, raw);
  }

  /**
   * 在用户消息中附加 Flow 文件引用，使流程指令获得用户级权威性。
   * LLM 对用户消息的遵循度远高于系统注入的上下文。
   */
  private injectFlowRefIntoUserMessage(
    sessionId: string,
    output: MessagesTransformOutput,
  ): void {
    const flowName = this.pendingFlowInjects.get(sessionId);
    if (!flowName) return;

    const flowPath = `docs/flow/[flow]${flowName}.md`;
    const directive =
      `\n\n---\n` +
      `⚠️ 本次任务必须严格按照 \`${flowPath}\` 中定义的流程步骤执行。\n` +
      `不得跳过任何步骤，特别是标记为 ⚠️ 的 Human-in-loop 步骤必须使用 question/confirm 工具与用户交互。`;

    const messages = output.messages;
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i] as { info?: { role?: string }; parts?: Array<{ type?: string; text?: string }> };
      if (msg.info?.role === "user" && msg.parts?.length) {
        const lastPart = msg.parts[msg.parts.length - 1];
        if (lastPart.type === "text") {
          lastPart.text = (lastPart.text ?? "") + directive;
        }
        break;
      }
    }

    this.pendingFlowInjects.delete(sessionId);
  }

  // ═══════════════════════════════════════════
  // 消息裁剪 — 三步管道
  // ═══════════════════════════════════════════

  private pruneMessages(
    messages: Array<{ role: string; content: string | null }>,
    sessionId?: string,
  ): Array<{ role: string; content: string | null }> {
    const maxTokens = this.config.contextInjection.maxStepTokens;
    const minRecent = 3;

    // Step 1: 步骤归属分类
    const tagged = this.tagMessagesByStep(messages, sessionId);

    // Step 2: 深度层级分配
    const depthAssigned = this.assignDepthLevel(tagged);

    // Step 3: Token 约束执行
    return this.pruneByDepth(depthAssigned, maxTokens, minRecent);
  }

  private tagMessagesByStep(
    messages: Array<{ role: string; content: string | null }>,
    sessionId?: string,
  ): StepTaggedMessage[] {
    const transitions = sessionId
      ? stepTransitions.get(sessionId) ?? []
      : [];
    const currentStepId =
      transitions.length > 0
        ? transitions[transitions.length - 1].stepId
        : "";

    if (transitions.length === 0) {
      return messages.map((msg) => ({
        message: msg as { role: string; content: string | null; [key: string]: unknown },
        stepId: currentStepId,
        stepDistance: 0,
      }));
    }

    // 为每条消息分配所属步骤（按消息在数组中的位置近似分配）
    // 实际使用时基于 stepTransition 时间戳更精确，此处用位置近似
    const totalMsgs = messages.length;
    const totalSteps = transitions.length;
    const msgsPerStep = Math.max(1, Math.floor(totalMsgs / totalSteps));

    return messages.map((msg, idx) => {
      const stepIdx = Math.min(
        Math.floor(idx / msgsPerStep),
        totalSteps - 1,
      );
      const stepId = transitions[stepIdx].stepId;
      const currentIdx = totalSteps - 1;
      const stepDistance = currentIdx - stepIdx;

      return {
        message: msg as { role: string; content: string | null; [key: string]: unknown },
        stepId,
        stepDistance: Math.max(0, stepDistance),
      };
    });
  }

  private assignDepthLevel(
    tagged: StepTaggedMessage[],
  ): DepthAssignedMessage[] {
    return tagged.map((msg) => {
      let depth: number;
      if (msg.stepDistance <= 0) depth = 0;
      else if (msg.stepDistance === 1) depth = 1;
      else if (msg.stepDistance === 2) depth = 2;
      else depth = 3;

      return { ...msg, depth };
    });
  }

  private pruneByDepth(
    messages: DepthAssignedMessage[],
    maxTokens: number,
    minRecent: number,
  ): Array<{ role: string; content: string | null }> {
    const PRUNE_PLACEHOLDER = "[前置步骤消息已裁剪]";
    const result = [...messages];
    let estimatedTokens = estimateTokens(
      JSON.stringify(result.map((m) => m.message)),
    );

    // 从高深度到低深度执行裁剪
    for (let depth = 3; depth >= 1; depth--) {
      if (estimatedTokens <= maxTokens) break;

      for (let i = 0; i < result.length - minRecent; i++) {
        const msg = result[i];
        if (msg.depth !== depth) continue;
        if (estimatedTokens <= maxTokens) break;

        // 保护：用户消息最大深度 2
        if (msg.message.role === "user" && depth >= 3) continue;

        if (depth === 3) {
          result[i] = {
            ...msg,
            message: {
              role: msg.message.role,
              content: PRUNE_PLACEHOLDER,
            },
          };
        } else if (depth === 2) {
          // 深度 2：工具输出替换为占位符，保留用户内容
          if (msg.message.role !== "user") {
            result[i] = {
              ...msg,
              message: {
                role: msg.message.role,
                content: PRUNE_PLACEHOLDER,
              },
            };
          }
        } else if (depth === 1) {
          // 深度 1：保留，不做裁剪
        }

        estimatedTokens = estimateTokens(
          JSON.stringify(result.map((m) => m.message)),
        );
      }
    }

    return result.map((m) => m.message);
  }
}

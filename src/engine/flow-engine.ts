/**
 * Flow Engine — vibe-pm 核心业务层
 *
 * Flow 文档解析、三明治上下文注入、消息裁剪、步骤流转协调。
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
    if (!task) return;

    const flowDef = await this.parseFlow(task.flow);
    const currentStep = flowDef.steps.find((s) => s.id === task.currentStep);
    if (!currentStep) return;

    // 注入指纹去重
    const regNames = currentStep.regulations;
    if (!shouldInject(sessionId, task.flow, task.currentStep, regNames)) {
      return;
    }

    // 读取 Constitution 和 Step 指定的 Regulation
    const constitution = this.readRegulation("constitution.md");
    const regulations = this.readRegulations(regNames);

    // 构建三明治注入
    const plan = this.buildInjectionLayers(
      flowDef,
      task,
      currentStep,
      constitution,
      regulations,
    );

    // 注入到 system prompt（SDK 格式：string[]）
    const parts: string[] = [];
    if (output.system.length > 0) {
      parts.push(...output.system);
    }
    parts.push(plan.layer1, plan.layer2);
    if (plan.layer3) {
      parts.push(plan.layer3);
    }
    output.system = parts;
  }

  async transformMessages(
    input: { sessionID?: string; [key: string]: unknown },
    output: MessagesTransformOutput,
  ): Promise<void> {
    const sessionId = input.sessionID;
    if (!sessionId) return;

    const task = await this.memory.getActiveTask(sessionId);
    if (!task) return;

    // 裁剪未启用
    if (!this.config.contextInjection.pruneIrrelevant) return;

    const messages = output.messages;
    if (!Array.isArray(messages) || messages.length === 0) return;

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

  private buildInjectionLayers(
    flowDef: FlowDefinition,
    task: Task,
    currentStep: StepDefinition,
    constitution: string,
    regulations: string[],
  ): InjectionPlan {
    // Layer 1: 全局视野
    const layer1 = this.buildGlobalOverview(flowDef, constitution, task);

    // Layer 2: 当前步骤详情
    const layer2 = this.buildCurrentStepDetail(
      currentStep,
      task,
      regulations,
    );

    // Layer 3: 前瞻窗口（条件注入）
    let layer3: string | null = null;
    if (!currentStep.humanInLoop) {
      const currentIdx = flowDef.steps.findIndex(
        (s) => s.id === task.currentStep,
      );
      const lookaheadSteps: StepDefinition[] = [];
      let lookahead = currentIdx + 1;
      while (
        lookahead < flowDef.steps.length &&
        !flowDef.steps[lookahead].humanInLoop &&
        lookaheadSteps.length < 2
      ) {
        lookaheadSteps.push(flowDef.steps[lookahead]);
        lookahead++;
      }
      if (lookaheadSteps.length > 0) {
        layer3 = this.buildLookaheadWindow(lookaheadSteps);
      }
    }

    return { layer1, layer2, layer3 };
  }

  private buildGlobalOverview(
    flowDef: FlowDefinition,
    constitution: string,
    task: Task,
  ): string {
    const parts: string[] = [];

    parts.push(`<constitution>\n${constitution}\n</constitution>`);

    if (flowDef.fsmDiagram) {
      parts.push(
        `\n<fsm-diagram flow="${task.flow}">\n${flowDef.fsmDiagram}\n</fsm-diagram>`,
      );
    }

    parts.push("\n<step-overview>");
    parts.push(`\n**当前步骤: ${task.currentStep} - ${task.currentStepName}**`);
    for (const step of flowDef.steps) {
      const isHiL = step.humanInLoop ? " ⚠️[需用户介入]" : "";
      const shortGoal =
        step.goal.length > 60 ? step.goal.slice(0, 60) + "..." : step.goal;
      parts.push(`\n- ${step.id}: ${step.name} — ${shortGoal}${isHiL}`);
    }
    parts.push("\n</step-overview>");

    return parts.join("");
  }

  private buildCurrentStepDetail(
    step: StepDefinition,
    task: Task,
    regulations: string[],
  ): string {
    const parts: string[] = [];

    parts.push(`\n<current-step id="${step.id}" name="${step.name}">`);
    parts.push(`\n**目标**: ${step.goal}`);
    parts.push(`\n**推荐 Agent**: ${step.agent}`);
    parts.push("\n---");
    for (const [i, instr] of step.instructions.entries()) {
      parts.push(`\n${i + 1}. ${instr}`);
    }
    parts.push("\n</current-step>");

    parts.push("\n<task-state>");
    parts.push(`\n- Session ID: ${task.sessionId}`);
    parts.push(`\n- Flow: ${task.flow}`);
    parts.push(`\n- 任务摘要: ${task.summary}`);
    parts.push(`\n- 开始时间: ${task.startAt}`);
    if (task.specRef) parts.push(`\n- Spec 文档: ${task.specRef}`);
    if (task.planRef) parts.push(`\n- 计划文档: ${task.planRef}`);
    parts.push("\n</task-state>");

    for (const reg of regulations) {
      parts.push(`\n<regulation>\n${reg}\n</regulation>`);
    }

    parts.push("\n<fsm-instructions>");
    parts.push("\n你正在执行 Flow 文档中定义的流程。");
    parts.push(`\n- 当前处于 **Step ${task.currentStep}: ${step.name}**`);
    if (step.humanInLoop) {
      parts.push(
        "\n- ⚠️⚠️⚠️ **本步骤需要用户介入！** 你必须使用 question / confirm 阻塞式工具向用户提问。每次只问 1 个问题，收到回复前不得继续。⚠️⚠️⚠️",
      );
    }
    parts.push(`\n- ${step.onComplete}`);
    parts.push("\n- 请严格按照 Flow 文档中的「完成后」描述推进步骤");
    parts.push("\n- 非 Human-in-loop 步骤完成后自行判断并推进");
    parts.push(
      "\n- 当你要推进步骤时，使用 pm_task_set_step 工具或明确告知",
    );
    parts.push("\n</fsm-instructions>");

    return parts.join("");
  }

  private buildLookaheadWindow(steps: StepDefinition[]): string {
    const parts: string[] = [];
    parts.push("\n<lookahead-window>");
    parts.push("\n> 以下步骤可在本对话中连续执行（非 HiL）：");
    for (const step of steps) {
      parts.push(`\n\n### Step ${step.id}: ${step.name}`);
      parts.push(`\n**目标**: ${step.goal}`);
      for (const [i, instr] of step.instructions.entries()) {
        parts.push(`\n${i + 1}. ${instr}`);
      }
      parts.push(`\n**完成后**: ${step.onComplete}`);
    }
    parts.push("\n</lookahead-window>");
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
   * 如 "pm-bug-fix" → "bug-fix"，"pm-new-feature" → "new-feature"。
   */
  resolveFlowFromCommand(command: string): string | null {
    const map = this.buildCommandFlowMap();
    return map.get(command) ?? null;
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
    if (!flowName) return null;

    const existing = await this.memory.getActiveTask(sessionId);
    if (existing) return null;

    try {
      const task = await this.startTask({
        sessionId,
        flow: flowName,
        summary: args || `${command} 任务`,
        specRef: undefined,
        planRef: undefined,
      });
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

/**
 * Flow Engine — vibe-pm 核心业务层
 *
 * Flow 文档解析、三明治上下文注入、消息裁剪、步骤流转协调。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { get_encoding } from "tiktoken";
import { MemorySystem } from "../memory/index.js";
import { DuplicateTaskError } from "../memory/errors.js";
import { logger } from "../core/logger.js";
import type { PluginConfig, SystemTransformOutput, MessagesTransformOutput } from "../core/types.js";
import type { Task } from "../memory/types.js";
import type {
  FlowDefinition,
  StepDefinition,
  InjectionPlan,
  StepTaggedMessage,
  DepthAssignedMessage,
  StartTaskParams,
} from "./types.js";
import {
  DuplicateActiveTaskError,
  FlowNotFoundError,
  FlowParseError,
} from "./errors.js";

// ─── Token 估算器 ───

const tokenizer = get_encoding("cl100k_base");

function estimateTokens(text: string): number {
  return tokenizer.encode(text).length;
}

// ─── 注入指纹去重 ───

const lastInjectedFingerprint = new Map<string, string>();

function computeFingerprint(
  sessionId: string,
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
  const fp = computeFingerprint(sessionId, flow, step, regulations);
  if (lastInjectedFingerprint.get(sessionId) === fp) return false;
  lastInjectedFingerprint.set(sessionId, fp);
  return true;
}

// ─── FlowEngine ───

export class FlowEngine {
  private projectDir: string;
  private config: PluginConfig;

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

  async onMessage(
    input: { sessionID?: string; [key: string]: unknown },
    _output: unknown,
  ): Promise<void> {
    const sessionId = input.sessionID;
    if (!sessionId) return;

    const task = await this.memory.getActiveTask(sessionId);
    if (!task) return; // 无活跃任务 → 透传

    // 有活跃任务 → 后续 injectContext 和 transformMessages 处理
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

    // 注入到 system prompt
    const parts = [output.system ?? "", plan.layer1, plan.layer2];
    if (plan.layer3) {
      parts.push(plan.layer3);
    }
    output.system = parts.join("\n");
  }

  async transformMessages(
    input: { sessionID?: string; messages?: unknown[]; [key: string]: unknown },
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

    // 消息裁剪
    const pruned = this.pruneMessages(messages as Array<{ role: string; content: string | null }>);
    output.messages = pruned;
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
      path.join(flowDir, `[flow]_${flowName}.md`),
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
      path.join(flowDir, `[flow]_${flowName}.md`),
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
      .map((f) => f.replace(/^\[flow\]_/, "").replace(/\.md$/, ""));
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

    await this.memory.updateStep(sessionId, step.id, step.name);
  }

  async getCurrentStep(sessionId: string): Promise<StepDefinition | null> {
    const task = await this.memory.getActiveTask(sessionId);
    if (!task) return null;

    const flowDef = await this.parseFlow(task.flow);
    return flowDef.steps.find((s) => s.id === task.currentStep) ?? null;
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
    const tableMatch = raw.match(/##\s+输入要求\s*\n.*?\n((?:\|.+\|[\s\S]*?))(?=\n##|\n---|$)/);
    if (!tableMatch) return [];
    const lines = tableMatch[1].split("\n").filter((l) => l.includes("|"));
    return lines.slice(1).map((line) => {
      const cols = line.split("|").map((c) => c.trim()).filter(Boolean);
      return {
        name: cols[0] ?? "",
        required: cols[1]?.toLowerCase() === "是",
        description: cols[2] ?? "",
      };
    });
  }

  private parseDeliverables(raw: string): string[] {
    const section = raw.match(/##\s+(?:默认)?交付清单\s*\n((?:[\s\S]*?))(?=\n##|\n---|$)/);
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
      const nextIdx = i + 1 < matches.length ? matches[i + 1].index : raw.length;
      const section = raw.slice(startIdx, nextIdx!);

      const step = this.parseOneStep(stepId, stepName, section);
      steps.push(step);
    }

    return steps;
  }

  private parseOneStep(id: string, name: string, section: string): StepDefinition {
    // 提取目标
    const goalMatch = section.match(/\*\*目标\*\*[：:]\s*(.+)/);
    const goal = goalMatch?.[1]?.trim() ?? "";

    // 提取执行 Agent
    const agentMatch = section.match(/\*\*执行 Agent\*\*[：:]\s*(.+)/);
    const agent = agentMatch?.[1]?.trim() ?? "";

    // 提取引用 Regulation
    const regMatch = section.match(/\*\*引用 Regulation\*\*[：:]\s*(.+)/);
    const regulations = regMatch?.[1]
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
      } else if (inInstructions && !/^\d+\.\s/.test(line) && line.trim() !== "") {
        inInstructions = false;
      }
    }

    // 提取完成后
    const onCompleteMatch = section.match(/\*\*完成后\*\*[：:]\s*(.+)/);
    const onComplete = onCompleteMatch?.[1]?.trim() ?? "";

    // Human-in-loop 检测
    const humanInLoop = section.includes("⚠️") || section.includes("需要用户介入");

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
    const regPath = path.join(this.projectDir, "docs", "regulation", filename);
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
    parts.push(
      `\n**当前步骤: ${task.currentStep} - ${task.currentStepName}**`,
    );
    for (const step of flowDef.steps) {
      const isHiL = step.humanInLoop ? " ⚠️[需用户介入]" : "";
      const shortGoal = step.goal.length > 60
        ? step.goal.slice(0, 60) + "..."
        : step.goal;
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
  // 消息裁剪
  // ═══════════════════════════════════════════

  private pruneMessages(
    messages: Array<{ role: string; content: string | null }>,
  ): Array<{ role: string; content: string | null }> {
    const maxTokens = this.config.contextInjection.maxStepTokens;

    // 简化裁剪：从旧到新，保留最近消息
    const minRecent = 3;
    let result = [...messages];
    let totalTokens = estimateTokens(JSON.stringify(result));

    // 从最旧的消息开始裁剪
    for (let i = 0; i < result.length - minRecent; i++) {
      if (totalTokens <= maxTokens) break;

      const oldTokens = estimateTokens(JSON.stringify(result[i]));

      // 保留用户消息
      if (result[i].role === "user") continue;

      // 替换为占位符
      result[i] = {
        role: result[i].role,
        content: "[前置步骤消息已裁剪]",
      };

      totalTokens = estimateTokens(JSON.stringify(result));
    }

    return result;
  }
}

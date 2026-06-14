/**
 * Flow Engine — vibe-pm 核心业务层
 *
 * Flow 文档解析、前缀固定 + 尾部变量上下文注入、消息裁剪、步骤流转协调。
 * 使用 @opencode-ai/plugin SDK 的 hook 类型。
 */

import * as fs from "node:fs";
import * as path from "node:path";
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
  StepTaggedMessage,
  DepthAssignedMessage,
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

// ─── Session 级别注入去重 ───

const injectedSessions = new Set<string>();

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

    // Session 级去重：每个 session 只注入一次
    if (injectedSessions.has(sessionId)) return;
    injectedSessions.add(sessionId);

    const constitution = this.readRegulation("constitution.md");
    const flowRaw = await this.readFlowContent(task.flow);

    const ctx = this.buildContext(constitution, task, flowRaw);

    const parts: string[] = [];
    parts.push(ctx.systemPrefix);
    if (output.system.length > 0) {
      parts.push(...output.system);
    }
    output.system = parts;

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

    const task = await this.memory.getActiveTask(sessionId);
    if (!task) return;

    // 裁剪未启用
    if (!this.config.contextInjection.pruneIrrelevant) return;

    const maxTokens = this.config.contextInjection.maxStepTokens;
    if (maxTokens <= 0) return; // 不限制

    // 惰性裁剪：仅当超过 80% 阈值
    const currentTokens = estimateTokens(JSON.stringify(messages));
    if (currentTokens < maxTokens * 0.8) return;

    // 消息裁剪
    const pruned = this.pruneMessages(
      messages as Array<{ role: string; content: string | null }>,
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

  async getCurrentStep(sessionId: string): Promise<StepDefinition | null> {
    const task = await this.memory.getActiveTask(sessionId);
    if (!task) return null;

    const flowDef = await this.parseFlow(task.flow);
    return flowDef.steps.find((s) => s.id === task.currentStep) ?? null;
  }

  /** 设置当前步骤，并更新任务状态和恢复注入 */
  async setStep(sessionId: string, step: string): Promise<void> {
    const task = await this.memory.getActiveTask(sessionId);
    if (!task) {
      throw new Error(`No active task found for session ${sessionId}`);
    }

    const flowDef = await this.parseFlow(task.flow);
    const stepDef = flowDef.steps.find((s) => s.id === step);
    if (!stepDef) {
      throw new Error(
        `Step "${step}" not found in flow "${task.flow}"`,
      );
    }

    await this.memory.updateStep(sessionId, step, stepDef.name);

    // 清除注入记录，允许下次对话重新注入最新步骤信息
    this.clearSessionInject(sessionId);
  }

  /** 清除指定 session 的注入记录，允许下次重新注入 */
  clearSessionInject(sessionId: string): void {
    injectedSessions.delete(sessionId);
  }

  /** 关闭当前任务并返回被关闭的 Task */
  async closeTask(sessionId: string): Promise<Task | null> {
    const task = await this.memory.getActiveTask(sessionId);
    if (!task) return null;

    await this.memory.closeTask(sessionId);
    return { ...task, closed: true };
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

  private buildContext(
    constitution: string,
    task: Task,
    flowRawContent: string,
  ): InjectedContext {
    const systemPrefix = [
      `<constitution>\n${constitution}\n</constitution>`,
      `\n<flow-document flow="${task.flow}">\n${flowRawContent}\n</flow-document>`,
      `\n<flow-control>\n${this.buildControlPrompt(task)}\n</flow-control>`,
      `\n<task-state>\n- Flow: ${task.flow}\n- 摘要: ${task.summary}\n- 开始时间: ${task.startAt}\n</task-state>`,
    ].join("");

    return { systemPrefix };
  }

  private buildControlPrompt(task?: Task): string {
    return [
      "## 流程执行规则（强制性）",
      "",
      "你必须严格按上方 Flow 文档定义的步骤顺序执行，不得跳过或合并步骤。",
      "",
      "### 执行规则",
      `1. 进入新步骤时 - 必须调用 \`pm_task_set_step\` 工具记录步骤进度（参数 step: "S2" 等）`,
      `2. 当前步骤完成后 - 查看该步骤的"**完成后**"说明，确定下一步骤后先调用 pm_task_set_step 再执行`,
      "3. Human-in-loop 步骤（标记 ⚠️）- 必须使用 question/confirm 工具等待用户确认，未收到确认不得继续",
      "4. 禁止行为: 禁止跳过步骤、禁止合并多步、禁止在确认前执行后续步骤",
    ].join("\n");
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

    let flowRaw: string;
    try {
      flowRaw = this.readFlowContentSync(flowName);
    } catch {
      this.pendingFlowInjects.delete(sessionId);
      return;
    }

    if (injectedSessions.has(sessionId)) return;
    injectedSessions.add(sessionId);

    const constitution = this.readRegulation("constitution.md");

    const prefixParts: string[] = [];
    prefixParts.push(
      `<constitution>\n${constitution}\n</constitution>`,
    );
    prefixParts.push(
      `\n<flow-document flow="${flowName}">\n${flowRaw}\n</flow-document>`,
    );
    prefixParts.push(
      `\n<flow-control>\n${this.buildControlPrompt()}\n</flow-control>`,
    );

    const parts: string[] = [];
    parts.push(prefixParts.join(""));
    if (output.system.length > 0) {
      parts.push(...output.system);
    }
    output.system = parts;

    this.pendingFlowInjects.delete(sessionId);
  }

  // ═══════════════════════════════════════════
  // 消息裁剪 — 三步管道
  // ═══════════════════════════════════════════

  private pruneMessages(
    messages: Array<{ role: string; content: string | null }>,
  ): Array<{ role: string; content: string | null }> {
    const maxTokens = this.config.contextInjection.maxStepTokens;
    const minRecent = 3;

    const tagged = this.tagMessagesByStep(messages);
    const depthAssigned = this.assignDepthLevel(tagged);
    return this.pruneByDepth(depthAssigned, maxTokens, minRecent);
  }

  private tagMessagesByStep(
    messages: Array<{ role: string; content: string | null }>,
  ): StepTaggedMessage[] {
    return messages.map((msg) => ({
      message: msg as { role: string; content: string | null; [key: string]: unknown },
      stepId: "",
      stepDistance: 0,
    }));
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

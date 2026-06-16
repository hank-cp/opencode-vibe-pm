/**
 * Flow Engine — LLM 主导流程控制
 *
 * 插件注入 buildControlPrompt，LLM 自行读文件、管理步骤、调工具。
 * FlowEngine 提供：指令生成 + Command→Flow 映射 + 工具服务。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { MemorySystem } from "../memory/index.js";
import { DuplicateTaskError } from "../memory/errors.js";
import type { Task } from "../memory/types.js";
import { FlowNotFoundError } from "./errors.js";

export interface StartTaskParams {
  sessionId: string;
  flow: string;
  summary: string;
  specRef?: string;
  planRef?: string;
}

export class FlowEngine {
  private projectDir: string;
  private commandFlowCache: Map<string, string> | null = null;

  constructor(
    private memory: MemorySystem,
    projectDir: string,
  ) {
    this.projectDir = projectDir;
  }

  buildControlPrompt(flowName?: string): string {
    const flowRef = flowName ? `docs/flow/[flow]${flowName}.md` : "docs/flow/";
    return [
      `<pm-control-rules>`,
      `## 流程执行规则`,
      ``,
      `你是流程执行者。你必须逐步骤推进任务，不得跳步。`,
      ``,
      `### 执行循环（每个步骤必须完整执行）`,
      ``,
      `\`\`\``,
      `对于当前步骤 S{n}：`,
      `  1. 调用 pm_task_set_step(step="S{n}") — 声明"我进入了 S{n}"`,
      `  2. 只读当前 S{n} 的"**目标**"和指令   — 暂不看后续步骤`,
      `  3. 执行当前步骤要求的全部动作          — 不越界`,
      `  4. 如果有 ⚠️ 标记 → 调用 question/confirm 工具，`,
      `     阻塞等待用户确认后才继续`,
      `  5. 查看"**完成后**"字段确定下一步      — 按 FSM 图转移`,
      ``,
      `在以上 1-5 全部完成之前，禁止进入下一步骤。`,
      `\`\`\``,
      ``,
      `### 步骤类型门禁`,
      ``,
      `| 步骤类型 | 允许做的 | 禁止做的 |`,
      `|----------|----------|----------|`,
      `| S1（理解） | 阅读描述、提问澄清、探索代码 | 修改任何文件、创建 todo、开始实现 |`,
      `| S{n}（带 ⚠️） | 先展示方案，再调用 question/confirm | 在确认前执行方案 |`,
      `| S{n}（编码） | 按确认方案改代码 | 改方案之外的文件、引入无关重构 |`,
      `| 最终步骤（合流） | 最终验证、询问是否提交 | 跳过验证直接结束 |`,
      ``,
      `### 红线（违反任一条 = 任务失败）`,
      ``,
      `🔴 在 pm_task_set_step 调用之前，不得执行当前步骤的任何动作`,
      `🔴 在 S1 阶段，任何文件编辑、文件删除、文件创建都是违规`,
      `🔴 带 ⚠️ 标记的步骤，必须调用 question/confirm 并等待用户回答`,
      `🔴 一个步骤未执行完（循环 1-5）就进入下一步，属于跳步`,
      `🔴 读完整个 flow 后直接跳到编码步骤，违反逐步骤原则`,
      ``,
      `### 启动`,
      ``,
       `1. 调用 pm_task_start(flow="${flowName ?? ""}", summary="简要描述")`,
      `2. 读取 ${flowRef}，只看 FSM 状态图（不急于深入阅读所有步骤详情）`,
      ``,
      `### 初始化`,
      ``,
      `1. 读取 docs/regulation/constitution.md — 确保所有行为不违反核心原则`,
      `2. 读取 docs/regulation/dictionary.md — 遵循术语中英对照`,
      `3. 确认 FSM 第一步 = S1，进入执行循环`,
      ``,
      `### 合规检查`,
      ``,
      `- constitution.md → 类型安全、验证强制、最小变更`,
      `- coding_style.md → 命名规范、格式、类型安全`,
      `- dictionary.md → 本地语言 ↔ 英文术语转换`,
      ``,
      `</pm-control-rules>`,
    ].join("\n");
  }

  // ─── 工具服务（由 LLM 通过 pm_task_* 工具调用）───

  async startTask(params: StartTaskParams): Promise<Task> {
    if (!this.flowExists(params.flow)) {
      throw new FlowNotFoundError(params.flow);
    }

    const existing = await this.memory.getActiveTask(params.sessionId);
    if (existing) {
      throw new Error(`Session ${params.sessionId} already has active task: ${existing.flow}`);
    }

    try {
      return await this.memory.createTask({
        sessionId: params.sessionId,
        flow: params.flow,
        currentStep: "S1",
        currentStepName: "就绪",
        startAt: new Date().toISOString(),
        summary: params.summary,
        specRef: params.specRef,
        planRef: params.planRef,
      });
    } catch (err) {
      if (err instanceof DuplicateTaskError) {
        throw new Error(`Session ${params.sessionId} already has active task.`);
      }
      throw err;
    }
  }

  async setStep(sessionId: string, step: string): Promise<void> {
    const task = await this.memory.getActiveTask(sessionId);
    if (!task) throw new Error(`No active task for session ${sessionId}`);
    const stepName = this.tryParseStepName(task.flow, step) ?? step;
    await this.memory.updateStep(sessionId, step, stepName);
  }

  async closeTask(sessionId: string): Promise<Task | null> {
    const task = await this.memory.getActiveTask(sessionId);
    if (!task) return null;
    await this.memory.closeTask(sessionId);
    return { ...task, closed: true };
  }

  // ─── Command → Flow 映射 ───

  resolveFlowFromCommand(command: string): string | null {
    const map = this.buildCommandFlowMap();
    return map.get(command.replace(/^\//, "")) ?? null;
  }

  clearCommandFlowCache(): void {
    this.commandFlowCache = null;
  }

  // ─── 内部 ───

  private flowExists(flowName: string): boolean {
    const flowDir = path.join(this.projectDir, "docs", "flow");
    return [path.join(flowDir, `${flowName}.md`), path.join(flowDir, `[flow]${flowName}.md`)].some(
      (c) => fs.existsSync(c),
    );
  }

  private tryParseStepName(flowName: string, stepId: string): string | null {
    const flowDir = path.join(this.projectDir, "docs", "flow");
    for (const fp of [path.join(flowDir, `${flowName}.md`), path.join(flowDir, `[flow]${flowName}.md`)]) {
      if (!fs.existsSync(fp)) continue;
      try {
        const raw = fs.readFileSync(fp, "utf-8");
        const m = raw.match(new RegExp(`###\\s+${stepId}:\\s*(.+)`, "i"));
        if (m) return m[1].trim();
      } catch {
        // ignore
      }
    }
    return null;
  }

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
        const m = raw.match(/\*\*Command\*\*:\s*`?(.+?)`?\s*$/m);
        if (m) {
          const cmd = m[1].trim().replace(/^\//, "");
          const name = file.replace(/^\[flow\]/, "").replace(/\.md$/, "");
          map.set(cmd, name);
        }
      } catch {
        // skip
      }
    }
    this.commandFlowCache = map;
    return map;
  }
}

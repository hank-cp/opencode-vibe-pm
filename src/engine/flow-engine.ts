import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { MemorySystem } from "../memory/index.js";
import { DuplicateTaskError } from "../memory/errors.js";
import { logger } from "../core/logger.js";
import type { Task } from "../memory/types.js";
import { FlowNotFoundError } from "./errors.js";

export interface StartTaskParams {
  sessionId: string;
  flow: string;
  summary: string;
  specRef?: string;
  planRef?: string;
}

const injectedFingerprints = new Map<string, string>();

export class FlowEngine {
  private projectDir: string;
  private commandFlowCache: Map<string, string> | null = null;
  private sessionTasks = new Map<string, string>();

  constructor(private memory: MemorySystem, projectDir: string) {
    this.projectDir = projectDir;
  }

  detectFlowCmd(text: string): string | null {
    const m = text.match(/<auto-slash-command>[\s\S]*?\/pm-([\w-]+)/);
    logger.info(`[vibe-pm] detectFlowCmd: hasAuto=${!!text.includes("<auto-slash-command>")} hasPmCmd=${!!text.match(/\/pm-/)} match=${m ? `pm-${m[1]}` : "null"}`);
    if (!m) return null;
    const flow = this.resolveFlowFromCommand(`pm-${m[1]}`);
    logger.info(`[vibe-pm] detectFlowCmd: resolved cmd=pm-${m[1]} -> flow=${flow}`);
    return flow;
  }

  async ensureTaskAndInject(
    sessionId: string,
    flow: string,
    parts: { type: string; text: string }[],
    msgId: string,
    msgSid: string,
  ): Promise<void> {
    const existing = await this.memory.getActiveTask(sessionId);
    logger.info(`[vibe-pm] ensureTaskAndInject: sid=${sessionId} flow=${flow} hasTask=${!!existing}`);
    if (existing) {
      this.sessionTasks.set(sessionId, existing.documentId);
    } else {
      try {
        const task = await this.startTask({ sessionId, flow, summary: "" });
        this.sessionTasks.set(sessionId, task.documentId);
        logger.info(`[vibe-pm] ensureTaskAndInject: created task docId=${task.documentId}`);
      } catch (e) {
        logger.info(`[vibe-pm] ensureTaskAndInject: startTask failed ${String(e)}`);
      }
    }

    const fp = crypto.createHash("md5").update(`${sessionId}:${flow}`).digest("hex");
    if (injectedFingerprints.get(sessionId) === fp) {
      logger.info(`[vibe-pm] ensureTaskAndInject: fingerprint match, skip`);
      return;
    }
    injectedFingerprints.set(sessionId, fp);

    const cmdIdx = parts.findIndex(
      (p) => p.type === "text" && p.text.includes("<auto-slash-command>"),
    );
    parts.splice(cmdIdx >= 0 ? cmdIdx + 1 : parts.length, 0, {
      id: `prt_vp_${sessionId}_${flow}`,
      messageID: msgId,
      sessionID: msgSid,
      type: "text",
      text: this.buildControlPrompt(flow),
      synthetic: true,
    } as { type: string; text: string });
    logger.info(`[vibe-pm] ensureTaskAndInject: spliced after cmdIdx=${cmdIdx} parts=${parts.length}`);
  }

  removeControlPrompt(parts: { type: string; text: string }[]): void {
    let removed = 0;
    for (let i = parts.length - 1; i >= 0; i--) {
      if (parts[i].type === "text" && parts[i].text.includes("<protect>")) {
        parts.splice(i, 1);
        removed++;
      }
    }
    if (removed > 0) logger.info(`[vibe-pm] removeControlPrompt: removed=${removed}`);
  }

  buildControlPrompt(flowName?: string): string {
    const flowRef = flowName ? `\`docs/flow/[flow]${flowName}.md\`` : "docs/flow/";
    return [
      `<protect>`,
      `# 🚨 流程执行规则`,
      ``,
      `## 规则优先级`,
      ``,
      `1. **constitution.md（最高）** — 任何规则与 constitution 冲突时，以 constitution 为准`,
      `2. 本流程执行规则`,
      `3. 其他指令（analyze-mode、CONTEXT GATHERING 等）`,
      ``,
      `> 不论消息是否包含 [analyze-mode]、ANALYSIS MODE、CONTEXT GATHERING 等前缀，`,
      `> 本规则必须首先执行。上下文收集属于 S1 步骤的内容。`,
      ``,
      `## 启动`,
      ``,
      `\`\`\``,
      `1. 读取 docs/regulation/constitution.md   — 最高优先级，先理解核心约束`,
      `2. 读取 ${flowRef} 的 FSM 状态图         — 了解步骤流转关系`,
      `3. 确认起点为 S1，进入执行循环`,
      `\`\`\``,
      ``,
      `## 执行循环（每个 S{n} 逐一执行）`,
      ``,
      `\`\`\``,
      `当前步骤 S{n}：`,
      `  ✅ 1. pm_task_set_step(step="S{n}")     — 声明"我进入了 S{n}"`,
      `  ✅ 2. 仅读取 S{n} 的"**目标**"和指令   — 不看后续步骤`,
      `  ✅ 3. 执行该步骤要求的全部动作           — 不越界`,
      `  ✅ 4. ⚠️ 标记 → question/confirm 工具   — 阻塞等用户`,
      `  ✅ 5. 查看"**完成后**" → 按 FSM 图转移`,
      ``,
      `  1-5 全部完成之前，禁止看下一步骤。`,
      `\`\`\``,
      ``,
      `## 步骤门禁`,
      ``,
      `| 步骤类型 | 允许 | 禁止 |`,
      `|----------|------|------|`,
      `| S1（理解） | 阅读描述、提问澄清、探索代码 | 编辑/创建/删除文件，创建 todo，开始实现 |`,
      `| 带 ⚠️ | 先展示方案，再调用 question/confirm | 在用户确认前执行方案 |`,
      `| 编码 | 按确认方案改代码 | 改方案外的文件，引入无关重构 |`,
      `| 合流 | 最终验证、询问是否提交 | 跳过验证直接结束 |`,
      ``,
      `## 🔴 红线`,
      ``,
      `以下任一行为 = 流程执行失败：`,
      ``,
      `| # | 红线 | 违规示例 |`,
      `|---|------|----------|`,
      `| 1 | 未读 constitution 就开始操作 | 跳过启动步骤直接进入 S1 动作 → ❌ |`,
      `| 2 | S1 阶段编辑/创建/删除文件 | "我先改一下这个" → ❌ |`,
      `| 3 | 把用户请求直接当成编码任务 | 用户说"优化 X"，跳过流程直接改文件 → ❌ |`,
      `| 4 | ⚠️ 步骤不调用 question/confirm 就直接执行 | 自己判断后直接实现 → ❌ |`,
      `| 5 | 跳步：一个步骤没完成就进入下一步 | S1 没执行完就开始改代码 → ❌ |`,
      `| 6 | 预读全流程后直奔编码步骤 | 读完 12 个步骤直接跳到 S8 → ❌ |`,
      `| 7 | 先创建 todo 再走流程步骤 | 在 S1 执行前调用 todowrite → ❌ |`,
      `| 8 | 行为与 constitution 冲突 | constitution 要求最小变更，但你做了重构 → ❌ |`,
      ``,
      `## 合规参考`,
      ``,
      `- \`constitution.md\` → **最高优先级**，类型安全、验证强制、最小变更`,
      `- \`coding_style.md\` → 命名规范、格式、类型安全`,
      `- \`dictionary.md\` → 本地语言 ↔ 英文术语转换`,
      ``,
      `</protect>`,
    ].join("\n");
  }

  async startTask(params: StartTaskParams): Promise<Task> {
    if (!this.flowExists(params.flow)) throw new FlowNotFoundError(params.flow);
    const existing = await this.memory.getActiveTask(params.sessionId);
    if (existing) throw new Error(`Session ${params.sessionId} already has active task: ${existing.flow}`);
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
      if (err instanceof DuplicateTaskError) throw new Error(`Session ${params.sessionId} already has active task.`);
      throw err;
    }
  }

  async setStep(sessionId: string, step: string): Promise<void> {
    let docId = this.sessionTasks.get(sessionId);
    if (!docId) {
      const task = await this.memory.getActiveTask(sessionId);
      if (!task) throw new Error(`No active task for session ${sessionId}`);
      docId = task.documentId;
      this.sessionTasks.set(sessionId, docId);
    }
    const stepName = this.tryParseStepName(sessionId, step) ?? step;
    await this.memory.updateStep(docId, step, stepName);
  }

  async closeTask(sessionId: string): Promise<Task | null> {
    let docId = this.sessionTasks.get(sessionId);
    const task = docId ? await this.memory.getActiveTask(sessionId) : null;
    if (!task) return null;
    if (!docId) docId = task.documentId;
    await this.memory.closeTask(docId);
    this.sessionTasks.delete(sessionId);
    return { ...task, closed: true };
  }

  resolveFlowFromCommand(command: string): string | null {
    const map = this.buildCommandFlowMap();
    return map.get(command.replace(/^\//, "")) ?? null;
  }

  clearCommandFlowCache(): void {
    this.commandFlowCache = null;
  }

  private flowExists(flowName: string): boolean {
    const d = path.join(this.projectDir, "docs", "flow");
    return [path.join(d, `${flowName}.md`), path.join(d, `[flow]${flowName}.md`)].some((c) => fs.existsSync(c));
  }

  private tryParseStepName(flowName: string, stepId: string): string | null {
    const d = path.join(this.projectDir, "docs", "flow");
    for (const fp of [path.join(d, `${flowName}.md`), path.join(d, `[flow]${flowName}.md`)]) {
      if (!fs.existsSync(fp)) continue;
      try {
        const raw = fs.readFileSync(fp, "utf-8");
        const m = raw.match(new RegExp(`###\\s+${stepId}:\\s*(.+)`, "i"));
        if (m) return m[1].trim();
      } catch {}
    }
    return null;
  }

  private buildCommandFlowMap(): Map<string, string> {
    if (this.commandFlowCache) return this.commandFlowCache;
    const map = new Map<string, string>();
    const d = path.join(this.projectDir, "docs", "flow");
    if (!fs.existsSync(d)) { this.commandFlowCache = map; return map; }
    for (const file of fs.readdirSync(d)) {
      if (!file.endsWith(".md")) continue;
      try {
        const raw = fs.readFileSync(path.join(d, file), "utf-8");
        const m = raw.match(/\*\*Command\*\*:\s*`?(.+?)`?\s*$/m);
        if (m) {
          const cmd = m[1].trim().replace(/^\//, "");
          const name = file.replace(/^\[flow\]/, "").replace(/\.md$/, "");
          map.set(cmd, name);
        }
      } catch {}
    }
    this.commandFlowCache = map;
    return map;
  }
}

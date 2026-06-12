/**
 * Template Manager
 *
 * 纯文件操作模块：模板扫描、安装（含 command 文件生成）、卸载（含 command 文件清理）。
 * 零外部依赖，按约定路径读写文件系统。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { TemplateMeta } from "./types.js";

// ─── 约定路径 ───

const TEMPLATE_DIR = "template";
const FLOW_DIR = "flow";
const REGULATION_DIR = "regulation";
const COMMANDS_DIR = ".opencode/commands";

// ─── 错误 ───

export class TemplateConflictError extends Error {
  constructor(flowName: string) {
    super(
      `Flow "${flowName}" already exists in /docs/flow/. Use --force to overwrite.`,
    );
    this.name = "TemplateConflictError";
  }
}

// ─── 内部辅助 ───

function getDocsDir(projectDir: string): string {
  return path.join(projectDir, "docs");
}

function getCommandsDir(projectDir: string): string {
  return path.join(projectDir, COMMANDS_DIR);
}

function stripLeadingSlash(command: string): string {
  return command.startsWith("/") ? command.slice(1) : command;
}

function parseTemplateMeta(raw: string, bundleDir: string): TemplateMeta | null {
  const idMatch = raw.match(/\*\*Template ID\*\*:\s*`(.+?)`/);
  const nameMatch = raw.match(/^#\s+(.+)/m);
  const catMatch = raw.match(/\*\*Category\*\*:\s*(.+)/);
  const descMatch = raw.match(/\*\*Description\*\*:\s*(.+)/);
  const verMatch = raw.match(/\*\*Version\*\*:\s*(.+)/);
  const cmdMatch = raw.match(/\*\*Command\*\*:\s*`?(.+?)`?\s*$/m);

  if (!idMatch || !nameMatch) return null;

  return {
    id: idMatch[1].trim(),
    name: nameMatch[1].trim(),
    category: catMatch?.[1]?.trim() ?? "",
    description: descMatch?.[1]?.trim() ?? "",
    version: verMatch?.[1]?.trim() ?? "1.0.0",
    command: cmdMatch?.[1]?.trim() ?? "",
    flowPath: path.join(bundleDir, "flow.md"),
    bundleDir,
  };
}

function parseFlowScenario(raw: string): string {
  const match = raw.match(/##\s+适用场景\s*\n+(.+?)(?=\n##|\n---)/s);
  return match?.[1]?.trim() ?? "";
}

function parseFlowInputReqs(raw: string): Array<{ name: string; required: string; description: string }> {
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
      required: cols[1] ?? "",
      description: cols[2] ?? "",
    };
  });
}

function generateCommandFile(
  meta: TemplateMeta,
  flowRaw: string,
): string {
  const scenario = parseFlowScenario(flowRaw);
  const inputReqs = parseFlowInputReqs(flowRaw);

  const parts: string[] = [];

  parts.push(`# ${meta.name}\n`);
  parts.push(`${scenario}\n`);
  parts.push("## 任务启动\n");
  parts.push(
    `当用户触发 \`${meta.command}\` 命令时，表示要启动 **${meta.name}** 流程下的任务。\n`,
  );

  if (inputReqs.length > 0) {
    parts.push("### 输入要求\n");
    parts.push("| 输入项 | 必填 | 说明 |");
    parts.push("|--------|------|------|");
    for (const req of inputReqs) {
      parts.push(`| ${req.name} | ${req.required} | ${req.description} |`);
    }
    parts.push("");
  }

  parts.push("### 执行步骤\n");
  parts.push("1. 与用户确认任务目标和摘要");
  parts.push("2. 收集上述输入要求中列出的必填项");
  parts.push(`3. 调用 \`/pm-task-start\` 启动任务：`);
  parts.push(`   - flow: \`${meta.id}\``);
  parts.push("   - summary: 用户确认的任务摘要");
  parts.push("   - specRef: 关联的 Spec 文档路径（如有）");
  parts.push("   - planRef: 关联的 Plan 文档路径（如有）");
  parts.push(`4. 按照 Flow 文档 \`${meta.id}\` 中定义的步骤逐步执行`);

  return parts.join("\n") + "\n";
}

// ─── 公开 API ───

export function scanTemplates(projectDir: string): TemplateMeta[] {
  const templateDir = path.join(getDocsDir(projectDir), TEMPLATE_DIR);
  if (!fs.existsSync(templateDir)) return [];

  const entries = fs.readdirSync(templateDir, { withFileTypes: true });
  const templates: TemplateMeta[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const bundleDir = path.join(templateDir, entry.name);
    const flowPath = path.join(bundleDir, "flow.md");
    if (!fs.existsSync(flowPath)) continue;

    const raw = fs.readFileSync(flowPath, "utf-8");
    const meta = parseTemplateMeta(raw, bundleDir);
    if (meta) templates.push(meta);
  }

  return templates;
}

export function installTemplate(
  projectDir: string,
  templateId: string,
): void {
  const templates = scanTemplates(projectDir);
  const meta = templates.find((t) => t.id === templateId);
  if (!meta) {
    throw new Error(`Template "${templateId}" not found.`);
  }

  const docsDir = getDocsDir(projectDir);
  const flowDir = path.join(docsDir, FLOW_DIR);
  const regDir = path.join(docsDir, REGULATION_DIR);

  // 确保目录存在
  fs.mkdirSync(flowDir, { recursive: true });
  fs.mkdirSync(regDir, { recursive: true });

  // 安装 Flow 文档
  const destFlow = path.join(flowDir, `[flow]${meta.id}.md`);
  if (fs.existsSync(destFlow)) {
    throw new TemplateConflictError(`[flow]${meta.id}`);
  }
  fs.copyFileSync(meta.flowPath, destFlow);

  // 安装配套 Regulation（如存在）
  const bundleRegDir = path.join(meta.bundleDir, "regulations");
  if (fs.existsSync(bundleRegDir)) {
    const regFiles = fs
      .readdirSync(bundleRegDir)
      .filter((f) => f.endsWith(".md"));
    for (const regFile of regFiles) {
      const src = path.join(bundleRegDir, regFile);
      const dest = path.join(regDir, regFile);
      if (!fs.existsSync(dest)) {
        fs.copyFileSync(src, dest);
      }
    }
  }

  // 生成 Command 文件到 .opencode/commands/
  if (meta.command) {
    const flowRaw = fs.readFileSync(meta.flowPath, "utf-8");
    const cmdDir = getCommandsDir(projectDir);
    fs.mkdirSync(cmdDir, { recursive: true });

    const cmdFileName = stripLeadingSlash(meta.command) + ".md";
    const cmdPath = path.join(cmdDir, cmdFileName);
    const cmdContent = generateCommandFile(meta, flowRaw);
    fs.writeFileSync(cmdPath, cmdContent, "utf-8");
  }
}

export function uninstallFlow(projectDir: string, flowName: string): void {
  const flowDir = path.join(getDocsDir(projectDir), FLOW_DIR);

  const candidates = [
    path.join(flowDir, `[flow]${flowName}.md`),
    path.join(flowDir, `${flowName}.md`),
  ];

  let removed = false;
  for (const cand of candidates) {
    if (fs.existsSync(cand)) {
      fs.rmSync(cand);
      removed = true;
      break;
    }
  }

  if (!removed) {
    throw new Error(`Flow "${flowName}" not found in /docs/flow/.`);
  }

  // 同时清理对应的 Command 文件
  const cmdDir = getCommandsDir(projectDir);
  if (fs.existsSync(cmdDir)) {
    // 尝试根据 flowName 推断 command 文件名
    const cmdFileName = `pm-${flowName}.md`;
    const cmdPath = path.join(cmdDir, cmdFileName);
    if (fs.existsSync(cmdPath)) {
      fs.rmSync(cmdPath);
    }
    // 也尝试不带 pm- 前缀的文件名
    const altCmdPath = path.join(cmdDir, `${flowName}.md`);
    if (fs.existsSync(altCmdPath)) {
      fs.rmSync(altCmdPath);
    }
  }
}

export function listInstalledFlows(projectDir: string): string[] {
  const flowDir = path.join(getDocsDir(projectDir), FLOW_DIR);
  if (!fs.existsSync(flowDir)) return [];

  return fs
    .readdirSync(flowDir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.replace(/^\[flow\][_]?/, "").replace(/\.md$/, ""));
}

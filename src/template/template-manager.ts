/**
 * Template Manager
 *
 * 纯文件操作模块：模板扫描、安装、卸载。
 * 零外部依赖，按约定路径读写文件系统。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { TemplateMeta } from "./types.js";

// ─── 约定路径 ───

const TEMPLATE_DIR = "template";
const FLOW_DIR = "flow";
const REGULATION_DIR = "regulation";

// ─── 错误 ───

export class TemplateConflictError extends Error {
  constructor(flowName: string) {
    super(`Flow "${flowName}" already exists in /docs/flow/. Use --force to overwrite.`);
    this.name = "TemplateConflictError";
  }
}

// ─── 内部辅助 ───

function getDocsDir(projectDir: string): string {
  return path.join(projectDir, "docs");
}

/** 简单 YAML front-matter / markdown meta 解析 */
function parseTemplateMeta(
  raw: string,
  bundleDir: string,
): TemplateMeta | null {
  const idMatch = raw.match(/\*\*Template ID\*\*:\s*`(.+?)`/);
  const nameMatch = raw.match(/^#\s+(.+)/m);
  const catMatch = raw.match(/\*\*Category\*\*:\s*(.+)/);
  const descMatch = raw.match(/\*\*Description\*\*:\s*(.+)/);
  const verMatch = raw.match(/\*\*Version\*\*:\s*(.+)/);

  if (!idMatch || !nameMatch) return null;

  return {
    id: idMatch[1].trim(),
    name: nameMatch[1].trim(),
    category: catMatch?.[1]?.trim() ?? "",
    description: descMatch?.[1]?.trim() ?? "",
    version: verMatch?.[1]?.trim() ?? "1.0.0",
    flowPath: path.join(bundleDir, "flow.md"),
    bundleDir,
  };
}

// ─── 公开 API ───

/** 扫描 /docs/template/ 子目录，返回所有可用模板 */
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

/** 安装模板：flow.md → /docs/flow/，regulations/*.md → /docs/regulation/ */
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
    const regFiles = fs.readdirSync(bundleRegDir).filter((f) => f.endsWith(".md"));
    for (const regFile of regFiles) {
      const src = path.join(bundleRegDir, regFile);
      const dest = path.join(regDir, regFile);
      if (!fs.existsSync(dest)) {
        fs.copyFileSync(src, dest);
      }
    }
  }
}

/** 卸载流程：删除 /docs/flow/ 中的对应文件（不删除 Regulation） */
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
    }
  }

  if (!removed) {
    throw new Error(`Flow "${flowName}" not found in /docs/flow/.`);
  }
}

/** 列出已安装的流程 */
export function listInstalledFlows(projectDir: string): string[] {
  const flowDir = path.join(getDocsDir(projectDir), FLOW_DIR);
  if (!fs.existsSync(flowDir)) return [];

  return fs
    .readdirSync(flowDir)
    .filter((f) => f.endsWith(".md"))
    .map((f) =>
      f
        .replace(/^\[flow\][_]?/, "")
        .replace(/\.md$/, ""),
    );
}

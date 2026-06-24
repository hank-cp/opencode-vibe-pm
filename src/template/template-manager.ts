/**
 * Template Manager
 *
 * 纯文件操作模块：模板扫描、安装（含 command 文件生成、regulation 自动安装）、卸载（含 command 文件清理）。
 * 零外部依赖，按约定路径读写文件系统。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { TemplateMeta } from "./types.js";
import { writeDcpConfig } from "../integration/index.js";

// ─── 约定路径 ───

const TEMPLATE_DIR = "template";
const FLOW_DIR = "flow";
const REGULATION_DIR = "regulation";
const CODING_STYLE_OUTPUT = "coding_style.md";
const CONSTITUTION_TEMPLATE = "constitution-template.md";
const CONSTITUTION_OUTPUT = "constitution.md";
const DICTIONARY_TEMPLATE = "dictionary-template.md";
const DICTIONARY_OUTPUT = "dictionary.md";

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

function getPluginTemplateDir(): string | null {
  const candidates = [
    path.join(import.meta.dirname, "docs", TEMPLATE_DIR),
    path.join(import.meta.dirname, "..", "docs", TEMPLATE_DIR),
    path.join(import.meta.dirname, "..", "..", "docs", TEMPLATE_DIR),
  ];
  for (const cand of candidates) {
    if (fs.existsSync(cand)) return cand;
  }
  return null;
}

function getDocsDir(projectDir: string): string {
  return path.join(projectDir, "docs");
}

function getTemplateDir(projectDir: string): string | null {
  const projectTemplate = path.join(getDocsDir(projectDir), TEMPLATE_DIR);
  if (fs.existsSync(projectTemplate)) return projectTemplate;
  return getPluginTemplateDir();
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

// ─── 编码风格模板安装 ───

const CODING_STYLE_TEMPLATE_SUBDIR = path.join(TEMPLATE_DIR, "_coding_style");
const CODING_STYLE_REG_SUBDIR = "coding_style";

function installCodingStyleFromTemplate(
  docsDir: string,
  regDir: string,
  programmingLanguages?: string[],
): void {
  const templateStyleDir = path.join(docsDir, CODING_STYLE_TEMPLATE_SUBDIR);
  if (!fs.existsSync(templateStyleDir)) return;

  const regStyleDir = path.join(regDir, CODING_STYLE_REG_SUBDIR);
  fs.mkdirSync(regStyleDir, { recursive: true });

  const languages = (programmingLanguages && programmingLanguages.length > 0)
    ? [...programmingLanguages]
    : ["General"];

  // 复制检测到的语言文件（已存在则跳过，不覆盖用户自定义内容）
  for (const lang of languages) {
    const srcPath = path.join(templateStyleDir, `${lang.toLowerCase()}.md`);
    const destPath = path.join(regStyleDir, `${lang.toLowerCase()}.md`);
    if (fs.existsSync(srcPath) && !fs.existsSync(destPath)) {
      fs.copyFileSync(srcPath, destPath);
    }
  }

  // 生成引用索引文件（如已存在则不覆盖）
  const indexDest = path.join(regDir, CODING_STYLE_OUTPUT);
  if (!fs.existsSync(indexDest)) {
    const indexContent = generateCodingStyleIndex(languages);
    fs.writeFileSync(indexDest, indexContent, "utf-8");
  }
}

function generateCodingStyleIndex(languages: string[]): string {
  const langEntries = [
    { name: "TypeScript", file: "typescript.md" },
    { name: "Python", file: "python.md" },
    { name: "Go", file: "go.md" },
    { name: "Rust", file: "rust.md" },
    { name: "Java", file: "java.md" },
    { name: "通用", file: "general.md" },
  ];

  const tableRows = langEntries
    .map((l) => `| ${l.name} | [${l.file}](./coding_style/${l.file}) |`)
    .join("\n");

  return `# 编码风格

> ⚠️ **重要 — 务必读取**：以下各语言的编码风格文件是本项目的强制规范。
> 在编写或修改任何代码之前，**必须**先读取当前语言对应的具体文件。
>
> 当前项目检测到的语言：${languages.join("、")}

## 通用规则

- 统一使用 UTF-8 编码，换行符使用 LF
- 代码注释使用英文
- 在系统边界（用户输入、外部 API）进行输入校验
- 所有错误必须显式处理
- 优先使用提前返回，减少嵌套层级

## 语言特定规范

请务必阅读以下与当前项目语言对应的编码规范文件：

| 语言 | 编码规范 |
|------|---------|
${tableRows}
`;
}

// ─── 公开 API ───

export function scanTemplates(projectDir: string): TemplateMeta[] {
  const templateDir = getTemplateDir(projectDir);
  if (!templateDir) return [];

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
  programmingLanguages?: string[],
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
    const destFlow = path.join(flowDir, `flow-${meta.id}.md`);
  if (fs.existsSync(destFlow)) {
      throw new TemplateConflictError(`flow-${meta.id}`);
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

  // 安装 Constitution（如缺失）
  installConstitutionFromTemplate(docsDir, regDir);

  // 安装 Dictionary（如缺失）
  installDictionaryFromTemplate(docsDir, regDir);

  // 安装 Coding Style（如缺失）
  installCodingStyleFromTemplate(docsDir, regDir, programmingLanguages);

  // 写入 DCP 保护配置（如果 DCP 插件已安装）
  writeDcpConfig(projectDir);
}

// ─── Regulation 安装 ───

function installRegulationFromTemplate(
  docsDir: string,
  regDir: string,
  templateName: string,
  outputName: string,
): void {
  const dest = path.join(regDir, outputName);
  if (fs.existsSync(dest)) return;

  const templatePath = path.join(docsDir, TEMPLATE_DIR, templateName);
  if (!fs.existsSync(templatePath)) return;

  fs.copyFileSync(templatePath, dest);
}

function installConstitutionFromTemplate(
  docsDir: string,
  regDir: string,
): void {
  installRegulationFromTemplate(
    docsDir,
    regDir,
    CONSTITUTION_TEMPLATE,
    CONSTITUTION_OUTPUT,
  );
}

function installDictionaryFromTemplate(
  docsDir: string,
  regDir: string,
): void {
  installRegulationFromTemplate(
    docsDir,
    regDir,
    DICTIONARY_TEMPLATE,
    DICTIONARY_OUTPUT,
  );
}

export function uninstallFlow(projectDir: string, flowName: string): void {
  const flowDir = path.join(getDocsDir(projectDir), FLOW_DIR);

  const candidates = [
      path.join(flowDir, `flow-${flowName}.md`),
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
}

export function listInstalledFlows(projectDir: string): string[] {
  const flowDir = path.join(getDocsDir(projectDir), FLOW_DIR);
  if (!fs.existsSync(flowDir)) return [];

  return fs
    .readdirSync(flowDir)
    .filter((f) => f.endsWith(".md"))
      .map((f) => f.replace(/^flow-[_]?/, "").replace(/\.md$/, ""));
}

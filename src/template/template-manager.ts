/**
 * Template Manager
 *
 * Pure file-operation module: Template Scanning, Installation
 * (including command file generation, regulation auto-install),
 * Uninstall (including command file cleanup).
 * Zero external dependencies, reads/writes filesystem by convention paths.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { TemplateMeta } from './types.js';
import { i18n } from '../i18n';

// ─── Convention Paths ───

const TEMPLATE_DIR = 'template';
const FLOW_DIR = 'flow';
const REGULATION_DIR = 'regulation';
const CODING_STYLE_OUTPUT = 'coding_style.md';
const CONSTITUTION_TEMPLATE = 'constitution-template.md';
const CONSTITUTION_OUTPUT = 'constitution.md';

// ─── Errors ───

export class TemplateConflictError extends Error {
  constructor(flowName: string) {
    super(`Flow "${flowName}" already exists in /docs/flow/. Use --force to overwrite.`);
    this.name = 'TemplateConflictError';
  }
}

// ─── Internal Helpers ───

export function getPluginTemplateDir(): string | null {
  const candidates = [
    path.join(import.meta.dirname, 'docs', TEMPLATE_DIR),
    path.join(import.meta.dirname, '..', 'docs', TEMPLATE_DIR),
    path.join(import.meta.dirname, '..', '..', 'docs', TEMPLATE_DIR),
  ];
  for (const cand of candidates) {
    if (fs.existsSync(cand)) return cand;
  }
  return null;
}

function getDocsDir(projectDir: string): string {
  return path.join(projectDir, 'docs');
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
    category: catMatch?.[1]?.trim() ?? '',
    description: descMatch?.[1]?.trim() ?? '',
    version: verMatch?.[1]?.trim() ?? '1.0.0',
    command: cmdMatch?.[1]?.trim() ?? '',
    flowPath: path.join(bundleDir, 'flow.md'),
    bundleDir,
  };
}

// ─── Coding Style Template Installation ───

const CODING_STYLE_TEMPLATE_SUBDIR = path.join(TEMPLATE_DIR, '_coding_style');
const CODING_STYLE_REG_SUBDIR = 'coding_style';

function installCodingStyleFromTemplate(
  docsDir: string,
  regDir: string,
  programmingLanguages?: string[]
): string[] {
  const result: string[] = [];
  let templateStyleDir = path.join(docsDir, CODING_STYLE_TEMPLATE_SUBDIR);
  if (!fs.existsSync(templateStyleDir)) {
    const pluginDir = getPluginTemplateDir();
    if (!pluginDir) return result;
    templateStyleDir = path.join(pluginDir, '_coding_style');
    if (!fs.existsSync(templateStyleDir)) return result;
  }

  const regStyleDir = path.join(regDir, CODING_STYLE_REG_SUBDIR);
  fs.mkdirSync(regStyleDir, { recursive: true });

  const languages =
    programmingLanguages && programmingLanguages.length > 0
      ? [...programmingLanguages]
      : ['General'];

  if (!languages.some((l) => l.toLowerCase() === 'general')) {
    languages.push('General');
  }

  for (const lang of languages) {
    const srcPath = path.join(templateStyleDir, `${lang.toLowerCase()}.md`);
    const destPath = path.join(regStyleDir, `${lang.toLowerCase()}.md`);
    if (fs.existsSync(srcPath) && !fs.existsSync(destPath)) {
      fs.copyFileSync(srcPath, destPath);
      result.push(destPath);
    }
  }

  const indexDest = path.join(regDir, CODING_STYLE_OUTPUT);
  if (!fs.existsSync(indexDest)) {
    const indexContent = generateCodingStyleIndex(languages);
    fs.writeFileSync(indexDest, indexContent, 'utf-8');
    result.push(indexDest);
  }

  return result;
}

function generateCodingStyleIndex(languages: string[]): string {
  const langEntries = [
    { name: 'TypeScript', file: 'typescript.md' },
    { name: 'Python', file: 'python.md' },
    { name: 'Go', file: 'go.md' },
    { name: 'Rust', file: 'rust.md' },
    { name: 'Java', file: 'java.md' },
    { name: 'General', file: 'general.md' },
  ];

  const lowerLanguages = languages.map((l) => l.toLowerCase());
  const filteredEntries = langEntries.filter((l) =>
    lowerLanguages.includes(l.file.replace('.md', ''))
  );

  const tableRows = filteredEntries
    .map((l) => `| ${l.name} | [${l.file}](./coding_style/${l.file}) |`)
    .join('\n');

  return i18n().codingStyle.generateIndex(languages.join(', '), tableRows);
}

// ─── Regulation Reference Extraction ───

/**
 * Extract referenced regulation file names from a flow document.
 * Supports three format variants:
 *   **Referenced Regulation**: coding_style.md
 *   **Referenced Regulations**: coding_style.md, constitution.md
 *   **Reference Regulation**: coding_style.md, constitution.md
 */
function extractReferencedRegulations(flowContent: string): string[] {
  const pattern = /\*\*(?:Referenced\s+Regulation[s]?|Reference\s+Regulation)\*\*\s*:\s*(.+)/gm;
  const results: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(flowContent)) !== null) {
    const files = match[1]
      .split(',')
      .map((f) => f.trim())
      .filter(Boolean);
    results.push(...files);
  }
  return [...new Set(results)];
}

// ─── Public API ───

export function scanTemplates(projectDir: string): TemplateMeta[] {
  const templateDir = getTemplateDir(projectDir);
  if (!templateDir) return [];

  const entries = fs.readdirSync(templateDir, { withFileTypes: true });
  const templates: TemplateMeta[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const bundleDir = path.join(templateDir, entry.name);
    const flowPath = path.join(bundleDir, 'flow.md');
    if (!fs.existsSync(flowPath)) continue;

    const raw = fs.readFileSync(flowPath, 'utf-8');
    const meta = parseTemplateMeta(raw, bundleDir);
    if (meta) templates.push(meta);
  }

  return templates;
}

export interface InstallResult {
  flowPath: string;
  regulationPaths: string[];
  codingStylePaths: string[];
}

export function installTemplate(
  projectDir: string,
  templateId: string,
  options?: {
    programmingLanguages?: string[];
    overwrite?: boolean;
    locale?: string;
  }
): InstallResult {
  const templates = scanTemplates(projectDir);
  const meta = templates.find((t) => t.id === templateId);
  if (!meta) {
    throw new Error(`Template "${templateId}" not found.`);
  }

  const docsDir = getDocsDir(projectDir);
  const flowDir = path.join(docsDir, FLOW_DIR);
  const regDir = path.join(docsDir, REGULATION_DIR);
  const regulationPaths: string[] = [];

  fs.mkdirSync(flowDir, { recursive: true });
  fs.mkdirSync(regDir, { recursive: true });

  const destFlow = path.join(flowDir, `flow-${meta.id}.md`);
  if (fs.existsSync(destFlow) && !options?.overwrite) {
    throw new TemplateConflictError(
      `"${templateId}" already exists in /docs/flow/. Use --force to overwrite.`
    );
  }
  fs.copyFileSync(meta.flowPath, destFlow);

  // Parse flow.md to find referenced regulations, then copy only those files
  const flowContent = fs.readFileSync(meta.flowPath, 'utf-8');
  const referencedRegs = extractReferencedRegulations(flowContent);
  const bundleRegDir = path.join(meta.bundleDir, 'regulations');
  if (referencedRegs.length > 0 && fs.existsSync(bundleRegDir)) {
    for (const regFile of referencedRegs) {
      const src = path.join(bundleRegDir, regFile);
      if (fs.existsSync(src)) {
        const dest = path.join(regDir, regFile);
        if (!fs.existsSync(dest)) {
          fs.copyFileSync(src, dest);
          regulationPaths.push(dest);
        }
      }
    }
  }

  const constResult = installRegulationFromTemplate(
    docsDir,
    regDir,
    CONSTITUTION_TEMPLATE,
    CONSTITUTION_OUTPUT
  );
  if (constResult) regulationPaths.push(constResult);

  const codingStylePaths = installCodingStyleFromTemplate(
    docsDir,
    regDir,
    options?.programmingLanguages
  );

  return {
    flowPath: destFlow,
    regulationPaths,
    codingStylePaths,
  };
}

// ─── Regulation Installation ───

function installRegulationFromTemplate(
  docsDir: string,
  regDir: string,
  templateName: string,
  outputName: string
): string | null {
  const dest = path.join(regDir, outputName);
  if (fs.existsSync(dest)) return null;

  let templatePath = path.join(docsDir, TEMPLATE_DIR, templateName);
  if (!fs.existsSync(templatePath)) {
    const pluginDir = getPluginTemplateDir();
    if (!pluginDir) return null;
    templatePath = path.join(pluginDir, templateName);
    if (!fs.existsSync(templatePath)) return null;
  }

  fs.copyFileSync(templatePath, dest);
  return dest;
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
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.replace(/^flow-[_]?/, '').replace(/\.md$/, ''));
}

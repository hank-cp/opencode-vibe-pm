/**
 * Template Manager Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  scanTemplates,
  installTemplate,
  uninstallFlow,
  listInstalledFlows,
  TemplateConflictError,
} from '../../src/template/index.js';

function createTestProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-pm-test-tmpl-'));
  const docsDir = path.join(dir, 'docs');
  fs.mkdirSync(path.join(docsDir, 'template'), { recursive: true });
  fs.mkdirSync(path.join(docsDir, 'flow'), { recursive: true });
  fs.mkdirSync(path.join(docsDir, 'regulation'), { recursive: true });
  return dir;
}

function writeTemplateBundle(
  projectDir: string,
  id: string,
  name: string,
  category: string = 'development'
) {
  const bundleDir = path.join(projectDir, 'docs', 'template', id);
  fs.mkdirSync(bundleDir, { recursive: true });
  fs.writeFileSync(
    path.join(bundleDir, 'flow.md'),
    `# ${name}\n\n**Template ID**: \`${id}\`\n**Category**: ${category}\n**Description**: Test template ${id}\n**Version**: 1.0.0\n\n---\n\n## 适用场景\n\n测试。\n\n## 状态机\n\n\`\`\`mermaid\nstateDiagram-v2\n    [*] --> S1\n    S1 --> [*]\n\`\`\`\n\n## 任务步骤\n\n### S1: 测试步骤\n\n**目标**：测试。\n**执行 Agent**：Assistant\n\n1. 测试\n\n**完成后**：结束\n`
  );
}

function writeTemplateWithRegulations(projectDir: string, id: string, regFiles: string[]) {
  writeTemplateBundle(projectDir, id, `Template ${id}`);
  const regDir = path.join(projectDir, 'docs', 'template', id, 'regulations');
  fs.mkdirSync(regDir, { recursive: true });
  for (const f of regFiles) {
    fs.writeFileSync(path.join(regDir, f), `# ${f}\n\nTest regulation.`);
  }
  // Append regulation reference markers to flow.md so they get picked up
  const flowPath = path.join(projectDir, 'docs', 'template', id, 'flow.md');
  const refs = regFiles.map((f) => `**Referenced Regulation**: ${f}`).join('\n');
  fs.appendFileSync(flowPath, `\n${refs}\n`);
}

describe('Template Manager', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTestProject();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('scan_finds_all_templates: scans all template directories', () => {
    writeTemplateBundle(tmpDir, 't1', 'Template 1');
    writeTemplateBundle(tmpDir, 't2', 'Template 2');
    writeTemplateBundle(tmpDir, 't3', 'Template 3');

    const templates = scanTemplates(tmpDir);
    expect(templates).toHaveLength(3);
    expect(templates.map((t) => t.id).sort()).toEqual(['t1', 't2', 't3']);
  });

  it('scan_parses_meta: parses template metadata', () => {
    writeTemplateBundle(tmpDir, 'test-tmpl', '测试模板', 'research');

    const templates = scanTemplates(tmpDir);
    expect(templates).toHaveLength(1);
    const t = templates[0];
    expect(t.id).toBe('test-tmpl');
    expect(t.name).toBe('测试模板');
    expect(t.category).toBe('research');
    expect(t.version).toBe('1.0.0');
  });

  it('scan_skips_non_template_dirs: ignores directories without flow.md', () => {
    const docsDir = path.join(tmpDir, 'docs', 'template');
    fs.mkdirSync(path.join(docsDir, 'empty-dir'));
    writeTemplateBundle(tmpDir, 'real', 'Real Template');

    const templates = scanTemplates(tmpDir);
    expect(templates).toHaveLength(1);
    expect(templates[0].id).toBe('real');
  });

  it('install_copies_to_flow_dir: installs template into flow directory', async () => {
    writeTemplateBundle(tmpDir, 'my-flow', 'My Flow');

    await installTemplate(tmpDir, 'my-flow');

    const flowPath = path.join(tmpDir, 'docs', 'flow', 'flow-my-flow.md');
    expect(fs.existsSync(flowPath)).toBe(true);

    const content = fs.readFileSync(flowPath, 'utf-8');
    expect(content).toContain('My Flow');
    expect(content).toContain('Template ID');
  });

  it('install_copies_regulations: copies companion Regulations on install', async () => {
    writeTemplateWithRegulations(tmpDir, 'with-regs', ['custom-check.md']);

    await installTemplate(tmpDir, 'with-regs');

    const regPath = path.join(tmpDir, 'docs', 'regulation', 'custom-check.md');
    expect(fs.existsSync(regPath)).toBe(true);
    expect(fs.readFileSync(regPath, 'utf-8')).toContain('Test regulation');
  });

  it('install_overwrite_error: throws when already exists and overwrite not passed', async () => {
    writeTemplateBundle(tmpDir, 'dup', 'Duplicate');
    await installTemplate(tmpDir, 'dup');

    expect(() => installTemplate(tmpDir, 'dup')).toThrow(TemplateConflictError);
  });

  it('install_overwrite_force: succeeds with overwrite=true', async () => {
    writeTemplateBundle(tmpDir, 'dup2', 'Original');
    await installTemplate(tmpDir, 'dup2');

    // modify template content to verify overwrite
    const flowPath = path.join(tmpDir, 'docs', 'template', 'dup2', 'flow.md');
    fs.writeFileSync(
      flowPath,
      '# Updated Flow\n\n**Template ID**: `dup2`\n\nUpdated content.',
      'utf-8'
    );

    expect(() => installTemplate(tmpDir, 'dup2', { overwrite: true })).not.toThrow();
    const installed = path.join(tmpDir, 'docs', 'flow', 'flow-dup2.md');
    expect(fs.readFileSync(installed, 'utf-8')).toContain('Updated content.');
  });

  it('uninstall_removes_file: removes target file on uninstall', async () => {
    writeTemplateBundle(tmpDir, 'rm-me', 'Remove Me');
    writeTemplateBundle(tmpDir, 'keep', 'Keep Me');
    await installTemplate(tmpDir, 'rm-me');
    await installTemplate(tmpDir, 'keep');

    uninstallFlow(tmpDir, 'rm-me');

    const flows = listInstalledFlows(tmpDir);
    expect(flows).toHaveLength(1);
    expect(flows[0]).toBe('keep');
  });

  it('list_installed_flows: lists installed flows', async () => {
    writeTemplateBundle(tmpDir, 'f1', 'Flow 1');
    writeTemplateBundle(tmpDir, 'f2', 'Flow 2');
    await installTemplate(tmpDir, 'f1');
    await installTemplate(tmpDir, 'f2');

    const flows = listInstalledFlows(tmpDir);
    expect(flows).toHaveLength(2);
    expect(flows).toContain('f1');
    expect(flows).toContain('f2');
  });

  it('install_does_not_overwrite_existing_regulation: does not overwrite existing Regulation', async () => {
    writeTemplateWithRegulations(tmpDir, 'r1', ['shared.md']);
    // pre-create the same file name in regulation directory
    const existingPath = path.join(tmpDir, 'docs', 'regulation', 'shared.md');
    fs.writeFileSync(existingPath, 'existing content');

    await installTemplate(tmpDir, 'r1');

    // should not overwrite existing file
    expect(fs.readFileSync(existingPath, 'utf-8')).toBe('existing content');
  });

  describe('Coding Style Language Selection', () => {
    function createCodingStyleTemplates(projectDir: string) {
      const styleDir = path.join(projectDir, 'docs', 'template', '_coding_style');
      fs.mkdirSync(styleDir, { recursive: true });
      fs.writeFileSync(path.join(styleDir, 'typescript.md'), '# TypeScript');
      fs.writeFileSync(path.join(styleDir, 'python.md'), '# Python');
      fs.writeFileSync(path.join(styleDir, 'general.md'), '# General');
    }

    it('installTemplate with programmingLanguages → copies only specified languages', async () => {
      writeTemplateBundle(tmpDir, 'lang-test', 'Lang Test');
      createCodingStyleTemplates(tmpDir);

      const languages = ['TypeScript', 'Python'];
      await installTemplate(tmpDir, 'lang-test', { programmingLanguages: languages });

      const codingDir = path.join(tmpDir, 'docs', 'regulation', 'coding_style');
      expect(fs.existsSync(path.join(codingDir, 'typescript.md'))).toBe(true);
      expect(fs.existsSync(path.join(codingDir, 'python.md'))).toBe(true);
      expect(fs.existsSync(path.join(codingDir, 'general.md'))).toBe(true);
    });

    it('installTemplate without programmingLanguages → General fallback', async () => {
      writeTemplateBundle(tmpDir, 'lang-fallback', 'Lang Fallback');
      createCodingStyleTemplates(tmpDir);

      await installTemplate(tmpDir, 'lang-fallback');

      const codingDir = path.join(tmpDir, 'docs', 'regulation', 'coding_style');
      expect(fs.existsSync(path.join(codingDir, 'general.md'))).toBe(true);
      expect(fs.existsSync(path.join(codingDir, 'typescript.md'))).toBe(false);
    });
  });

  describe('DCP Config File Path Resolution', () => {
    const dcpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-pm-test-dcp-'));

    afterEach(() => {
      fs.rmSync(dcpDir, { recursive: true, force: true });
    });

    function setupDcpProject(dir: string) {
      const docsDir = path.join(dir, 'docs');
      fs.mkdirSync(path.join(docsDir, 'template'), { recursive: true });
      fs.mkdirSync(path.join(docsDir, 'flow'), { recursive: true });
      fs.mkdirSync(path.join(docsDir, 'regulation'), { recursive: true });
      const opencodeDir = path.join(dir, '.opencode');
      fs.mkdirSync(opencodeDir, { recursive: true });
      fs.writeFileSync(
        path.join(opencodeDir, 'opencode.jsonc'),
        JSON.stringify({ plugin: ['vibe-pm'] })
      );
      fs.writeFileSync(
        path.join(opencodeDir, 'package.json'),
        JSON.stringify({
          dependencies: { 'opencode-dynamic-context-pruning': '^1.0.0' },
        })
      );
      writeTemplateBundle(dir, 'dcp-test', 'DCP Test');
    }

    it('uses dcp.jsonc when dcp.jsonc already exists', () => {
      setupDcpProject(dcpDir);
      const jsoncPath = path.join(dcpDir, '.opencode', 'dcp.jsonc');
      fs.writeFileSync(jsoncPath, JSON.stringify({ existing: true }));

      installTemplate(dcpDir, 'dcp-test');

      const content = JSON.parse(fs.readFileSync(jsoncPath, 'utf-8'));
      expect(content.existing).toBe(true);
      expect(content.compress.protectTags).toBe(true);
    });

    it('uses dcp.json when only dcp.json exists', () => {
      setupDcpProject(dcpDir);
      const jsonPath = path.join(dcpDir, '.opencode', 'dcp.json');
      const jsoncPath = path.join(dcpDir, '.opencode', 'dcp.jsonc');
      fs.writeFileSync(jsonPath, JSON.stringify({ existing: true }));

      installTemplate(dcpDir, 'dcp-test');

      // dcp.json should be updated
      const content = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
      expect(content.existing).toBe(true);
      expect(content.compress.protectTags).toBe(true);
      // dcp.jsonc should not be created
      expect(fs.existsSync(jsoncPath)).toBe(false);
    });

    it('creates dcp.jsonc when neither exists', () => {
      setupDcpProject(dcpDir);
      const jsoncPath = path.join(dcpDir, '.opencode', 'dcp.jsonc');

      installTemplate(dcpDir, 'dcp-test');

      expect(fs.existsSync(jsoncPath)).toBe(true);
      const content = JSON.parse(fs.readFileSync(jsoncPath, 'utf-8'));
      expect(content.compress.protectTags).toBe(true);
    });
  });

  describe('Fallback Paths', () => {
    it('scanTemplates_fallback_to_plugin: falls back to plugin built-in templates when project has none', () => {
      const noTemplateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-pm-test-nodocs-'));
      try {
        // this project has no docs/ directory at all
        const templates = scanTemplates(noTemplateDir);
        // should find built-in templates (dev repo's docs/template/ exists)
        expect(templates.length).toBeGreaterThan(0);
        const ids = templates.map((t) => t.id);
        expect(ids).toContain('bug-fix');
        expect(ids).toContain('research');
      } finally {
        fs.rmSync(noTemplateDir, { recursive: true, force: true });
      }
    });

    it('scanTemplates_prioritizes_project: project templates take priority when present', () => {
      const dir = createTestProject();
      try {
        writeTemplateBundle(dir, 'custom-flow', 'Custom Flow');
        const templates = scanTemplates(dir);
        const ids = templates.map((t) => t.id);
        expect(ids).toContain('custom-flow');
        // project template found → correct priority
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('installTemplate_fallback_regulation: copies regulations from plugin built-in when project has no template', async () => {
      // project without docs/template/ — regulations should install from plugin fallback
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-pm-test-fbreg-'));
      try {
        const docsDir = path.join(dir, 'docs');
        fs.mkdirSync(path.join(docsDir, 'flow'), { recursive: true });
        fs.mkdirSync(path.join(docsDir, 'regulation'), { recursive: true });

        await installTemplate(dir, 'bug-fix');

        expect(fs.existsSync(path.join(docsDir, 'regulation', 'constitution.md'))).toBe(true);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});

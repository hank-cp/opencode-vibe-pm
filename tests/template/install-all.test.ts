/**
 * Batch Installation Tests — `/pm-install-flow all`
 *
 * Covers the three-bucket summary (installed / skipped / failed), the
 * skip-existing strategy, overwrite behaviour, failure isolation, idempotency
 * and parameter exclusivity.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { installAllTemplates, installTemplate, TemplateConflictError } from '../../src/template/index.js';

function createTestProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-pm-test-all-'));
  const docsDir = path.join(dir, 'docs');
  fs.mkdirSync(path.join(docsDir, 'template'), { recursive: true });
  fs.mkdirSync(path.join(docsDir, 'flow'), { recursive: true });
  fs.mkdirSync(path.join(docsDir, 'regulation'), { recursive: true });
  return dir;
}

function writeTemplateBundle(projectDir: string, id: string, name: string) {
  const bundleDir = path.join(projectDir, 'docs', 'template', id);
  fs.mkdirSync(bundleDir, { recursive: true });
  fs.writeFileSync(
    path.join(bundleDir, 'flow.md'),
    `# ${name}\n\n**Template ID**: \`${id}\`\n**Category**: development\n**Description**: Test template ${id}\n**Command**: \`/pm-${id}\`\n**Version**: 1.0.0\n\n---\n\n## 适用场景\n\n测试。\n\n## 状态机\n\n\`\`\`mermaid\nstateDiagram-v2\n    [*] --> S1\n    S1 --> [*]\n\`\`\`\n\n## 任务步骤\n\n### S1: 测试步骤\n\n**目标**：测试。\n**执行 Agent**：Assistant\n\n1. 测试\n\n**完成后**：结束\n`,
  );
}

function flowDocPath(projectDir: string, id: string): string {
  return path.join(projectDir, 'docs', 'flow', `flow-${id}.md`);
}

function writeTemplateWithRegulation(projectDir: string, id: string, regFile: string) {
  writeTemplateBundle(projectDir, id, `Template ${id}`);
  const regDir = path.join(projectDir, 'docs', 'template', id, 'regulation');
  fs.mkdirSync(regDir, { recursive: true });
  fs.writeFileSync(path.join(regDir, regFile), `# ${regFile}\n\nTest regulation.\n`);
  fs.appendFileSync(
    path.join(projectDir, 'docs', 'template', id, 'flow.md'),
    `\n**Referenced Regulation**: ${regFile}\n`,
  );
}

describe('Batch installation (installAllTemplates)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTestProject();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('install_all_installs_every_template: installs all templates in the library', () => {
    writeTemplateBundle(tmpDir, 't1', 'Template 1');
    writeTemplateBundle(tmpDir, 't2', 'Template 2');
    writeTemplateBundle(tmpDir, 't3', 'Template 3');

    const result = installAllTemplates(tmpDir);

    expect(result.installed.sort()).toEqual(['t1', 't2', 't3']);
    expect(result.skipped).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(result.flowPaths).toHaveLength(3);
    for (const id of ['t1', 't2', 't3']) {
      expect(fs.existsSync(flowDocPath(tmpDir, id))).toBe(true);
    }
  });

  it('install_all_skips_existing: leaves already-installed flows untouched', () => {
    writeTemplateBundle(tmpDir, 't1', 'Template 1');
    writeTemplateBundle(tmpDir, 't2', 'Template 2');
    fs.writeFileSync(flowDocPath(tmpDir, 't1'), '# hand edited by the user\n');

    const result = installAllTemplates(tmpDir);

    expect(result.installed).toEqual(['t2']);
    expect(result.skipped).toEqual(['t1']);
    expect(fs.readFileSync(flowDocPath(tmpDir, 't1'), 'utf-8')).toBe(
      '# hand edited by the user\n',
    );
  });

  it('install_all_overwrites_when_forced: overwrite=true replaces existing flows', () => {
    writeTemplateBundle(tmpDir, 't1', 'Template 1');
    fs.writeFileSync(flowDocPath(tmpDir, 't1'), '# stale content\n');

    const result = installAllTemplates(tmpDir, { overwrite: true });

    expect(result.installed).toEqual(['t1']);
    expect(result.skipped).toEqual([]);
    expect(fs.readFileSync(flowDocPath(tmpDir, 't1'), 'utf-8')).toContain('**Template ID**: `t1`');
  });

  it('install_all_continues_after_failure: one failing template does not abort the batch', () => {
    writeTemplateBundle(tmpDir, 't1', 'Template 1');
    writeTemplateBundle(tmpDir, 'broken', 'Broken Template');
    writeTemplateBundle(tmpDir, 't3', 'Template 3');
    // Occupy the target path with a directory so the copy step fails for this
    // template only (scanTemplates already succeeded — the read happens earlier).
    fs.mkdirSync(flowDocPath(tmpDir, 'broken'), { recursive: true });

    const result = installAllTemplates(tmpDir);

    expect(result.installed.sort()).toEqual(['t1', 't3']);
    expect(result.skipped).toEqual([]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].id).toBe('broken');
    expect(result.failed[0].reason).not.toBe('');
    expect(fs.existsSync(flowDocPath(tmpDir, 't1'))).toBe(true);
    expect(fs.existsSync(flowDocPath(tmpDir, 't3'))).toBe(true);
  });

  it('install_all_is_idempotent: a second run installs nothing and skips everything', () => {
    writeTemplateBundle(tmpDir, 't1', 'Template 1');
    writeTemplateBundle(tmpDir, 't2', 'Template 2');

    installAllTemplates(tmpDir);
    const second = installAllTemplates(tmpDir);

    expect(second.installed).toEqual([]);
    expect(second.skipped.sort()).toEqual(['t1', 't2']);
    expect(second.failed).toEqual([]);
  });

  it('install_all_reports_three_buckets: summary separates installed / skipped / failed', () => {
    writeTemplateBundle(tmpDir, 'fresh', 'Fresh Template');
    writeTemplateBundle(tmpDir, 'existing', 'Existing Template');
    writeTemplateBundle(tmpDir, 'broken', 'Broken Template');
    fs.writeFileSync(flowDocPath(tmpDir, 'existing'), '# already there\n');
    fs.mkdirSync(flowDocPath(tmpDir, 'broken'), { recursive: true });

    const result = installAllTemplates(tmpDir);

    expect(result.installed).toEqual(['fresh']);
    expect(result.skipped).toEqual(['existing']);
    expect(result.failed.map((f) => f.id)).toEqual(['broken']);
  });

  it('install_all_returns_empty_summary_when_no_templates_exist', () => {
    const result = installAllTemplates(tmpDir);

    expect(result).toEqual({
      installed: [],
      skipped: [],
      failed: [],
      flowPaths: [],
      regulationPaths: [],
      codingStylePaths: [],
    });
  });

  it('install_all_leaves_no_half_installed_template: a rolled-back template is retried on the next run', () => {
    writeTemplateWithRegulation(tmpDir, 't1', 't1-reg.md');
    writeTemplateBundle(tmpDir, 't2', 'Template 2');
    // Make t1's regulation unreadable so its install throws after the flow doc
    // was copied — the rollback path. t2 is unaffected.
    const regSrc = path.join(tmpDir, 'docs', 'template', 't1', 'regulation', 't1-reg.md');
    fs.chmodSync(regSrc, 0o000);

    const first = installAllTemplates(tmpDir);

    expect(first.installed).toEqual(['t2']);
    expect(first.failed.map((f) => f.id)).toEqual(['t1']);
    // t1 must NOT be left behind, otherwise the next run would skip it forever.
    expect(fs.existsSync(flowDocPath(tmpDir, 't1'))).toBe(false);

    fs.chmodSync(regSrc, 0o644);
    const second = installAllTemplates(tmpDir);

    expect(second.installed).toEqual(['t1']);
    expect(second.skipped).toEqual(['t2']);
    expect(second.failed).toEqual([]);
    expect(fs.existsSync(path.join(tmpDir, 'docs', 'regulation', 't1-reg.md'))).toBe(true);
  });
});

describe('installTemplate skipExisting option', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTestProject();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('skipExisting_disabled_keeps_throwing: default behaviour is unchanged', () => {
    writeTemplateBundle(tmpDir, 't1', 'Template 1');
    installTemplate(tmpDir, 't1');

    expect(() => installTemplate(tmpDir, 't1')).toThrow(TemplateConflictError);
  });

  it('skipExisting_enabled_returns_skipped: nothing is written when skipping', () => {
    writeTemplateBundle(tmpDir, 't1', 'Template 1');
    installTemplate(tmpDir, 't1');
    fs.writeFileSync(flowDocPath(tmpDir, 't1'), '# hand edited by the user\n');

    const result = installTemplate(tmpDir, 't1', { skipExisting: true });

    expect(result.skipped).toBe(true);
    expect(fs.readFileSync(flowDocPath(tmpDir, 't1'), 'utf-8')).toBe(
      '# hand edited by the user\n',
    );
  });

  it('skipExisting_enabled_still_installs_a_fresh_template', () => {
    writeTemplateBundle(tmpDir, 't1', 'Template 1');

    const result = installTemplate(tmpDir, 't1', { skipExisting: true });

    expect(result.skipped).toBe(false);
    expect(fs.existsSync(flowDocPath(tmpDir, 't1'))).toBe(true);
  });

  it('non_file_entry_reports_a_readable_conflict: a directory squatting the target is explained, not EISDIR', () => {
    writeTemplateBundle(tmpDir, 't1', 'Template 1');
    fs.mkdirSync(flowDocPath(tmpDir, 't1'), { recursive: true });

    expect(() => installTemplate(tmpDir, 't1')).toThrow(TemplateConflictError);
    expect(() => installTemplate(tmpDir, 't1')).toThrow(/non-file entry/);
  });

  it('failed_install_rolls_back_the_flow_document: a later step failing leaves nothing half-installed', () => {
    writeTemplateBundle(tmpDir, 't1', 'Template 1');
    // `coding_style` must be a directory; as a regular file mkdirSync throws
    // AFTER the flow document was copied, which is the rollback path.
    fs.writeFileSync(path.join(tmpDir, 'docs', 'regulation', 'coding_style'), 'not a dir');

    expect(() => installTemplate(tmpDir, 't1')).toThrow();
    expect(fs.existsSync(flowDocPath(tmpDir, 't1'))).toBe(false);
  });
});
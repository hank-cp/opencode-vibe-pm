/**
 * Template Manager 测试
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  scanTemplates,
  installTemplate,
  uninstallFlow,
  listInstalledFlows,
  TemplateConflictError,
} from "../../src/template/index.js";

function createTestProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-pm-test-tmpl-"));
  const docsDir = path.join(dir, "docs");
  fs.mkdirSync(path.join(docsDir, "template"), { recursive: true });
  fs.mkdirSync(path.join(docsDir, "flow"), { recursive: true });
  fs.mkdirSync(path.join(docsDir, "regulation"), { recursive: true });
  return dir;
}

function writeTemplateBundle(
  projectDir: string,
  id: string,
  name: string,
  category: string = "development",
) {
  const bundleDir = path.join(projectDir, "docs", "template", id);
  fs.mkdirSync(bundleDir, { recursive: true });
  fs.writeFileSync(
    path.join(bundleDir, "flow.md"),
    `# ${name}\n\n**Template ID**: \`${id}\`\n**Category**: ${category}\n**Description**: Test template ${id}\n**Version**: 1.0.0\n\n---\n\n## 适用场景\n\n测试。\n\n## 状态机\n\n\`\`\`mermaid\nstateDiagram-v2\n    [*] --> S1\n    S1 --> [*]\n\`\`\`\n\n## 任务步骤\n\n### S1: 测试步骤\n\n**目标**：测试。\n**执行 Agent**：Assistant\n\n1. 测试\n\n**完成后**：结束\n`,
  );
}

function writeTemplateWithRegulations(
  projectDir: string,
  id: string,
  regFiles: string[],
) {
  writeTemplateBundle(projectDir, id, `Template ${id}`);
  const regDir = path.join(projectDir, "docs", "template", id, "regulations");
  fs.mkdirSync(regDir, { recursive: true });
  for (const f of regFiles) {
    fs.writeFileSync(path.join(regDir, f), `# ${f}\n\nTest regulation.`);
  }
}

describe("Template Manager", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTestProject();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("scan_finds_all_templates: 扫描所有模板目录", () => {
    writeTemplateBundle(tmpDir, "t1", "Template 1");
    writeTemplateBundle(tmpDir, "t2", "Template 2");
    writeTemplateBundle(tmpDir, "t3", "Template 3");

    const templates = scanTemplates(tmpDir);
    expect(templates).toHaveLength(3);
    expect(templates.map((t) => t.id).sort()).toEqual(["t1", "t2", "t3"]);
  });

  it("scan_parses_meta: 解析模板元信息", () => {
    writeTemplateBundle(tmpDir, "test-tmpl", "测试模板", "research");

    const templates = scanTemplates(tmpDir);
    expect(templates).toHaveLength(1);
    const t = templates[0];
    expect(t.id).toBe("test-tmpl");
    expect(t.name).toBe("测试模板");
    expect(t.category).toBe("research");
    expect(t.version).toBe("1.0.0");
  });

  it("scan_skips_non_template_dirs: 忽略无 flow.md 的目录", () => {
    const docsDir = path.join(tmpDir, "docs", "template");
    fs.mkdirSync(path.join(docsDir, "empty-dir"));
    writeTemplateBundle(tmpDir, "real", "Real Template");

    const templates = scanTemplates(tmpDir);
    expect(templates).toHaveLength(1);
    expect(templates[0].id).toBe("real");
  });

  it("install_copies_to_flow_dir: 安装模板到 flow 目录", () => {
    writeTemplateBundle(tmpDir, "my-flow", "My Flow");

    installTemplate(tmpDir, "my-flow");

    const flowPath = path.join(tmpDir, "docs", "flow", "flow-my-flow.md");
    expect(fs.existsSync(flowPath)).toBe(true);

    const content = fs.readFileSync(flowPath, "utf-8");
    expect(content).toContain("My Flow");
    expect(content).toContain("Template ID");
  });

  it("install_copies_regulations: 安装时复制配套 Regulation", () => {
    writeTemplateWithRegulations(tmpDir, "with-regs", ["custom-check.md"]);

    installTemplate(tmpDir, "with-regs");

    const regPath = path.join(tmpDir, "docs", "regulation", "custom-check.md");
    expect(fs.existsSync(regPath)).toBe(true);
    expect(fs.readFileSync(regPath, "utf-8")).toContain("Test regulation");
  });

  it("install_overwrite_error: 已存在时抛错", () => {
    writeTemplateBundle(tmpDir, "dup", "Duplicate");
    installTemplate(tmpDir, "dup");

    expect(() => installTemplate(tmpDir, "dup")).toThrow(
      TemplateConflictError,
    );
  });

  it("uninstall_removes_file: 卸载删除目标文件", () => {
    writeTemplateBundle(tmpDir, "rm-me", "Remove Me");
    writeTemplateBundle(tmpDir, "keep", "Keep Me");
    installTemplate(tmpDir, "rm-me");
    installTemplate(tmpDir, "keep");

    uninstallFlow(tmpDir, "rm-me");

    const flows = listInstalledFlows(tmpDir);
    expect(flows).toHaveLength(1);
    expect(flows[0]).toBe("keep");
  });

  it("list_installed_flows: 列出已安装流程", () => {
    writeTemplateBundle(tmpDir, "f1", "Flow 1");
    writeTemplateBundle(tmpDir, "f2", "Flow 2");
    installTemplate(tmpDir, "f1");
    installTemplate(tmpDir, "f2");

    const flows = listInstalledFlows(tmpDir);
    expect(flows).toHaveLength(2);
    expect(flows).toContain("f1");
    expect(flows).toContain("f2");
  });

  it("install_does_not_overwrite_existing_regulation: 已存在的 Regulation 不覆盖", () => {
    writeTemplateWithRegulations(tmpDir, "r1", ["shared.md"]);
    // 在 regulation 目录预置同名文件
    const existingPath = path.join(tmpDir, "docs", "regulation", "shared.md");
    fs.writeFileSync(existingPath, "existing content");

    installTemplate(tmpDir, "r1");

    // 不应覆盖已有文件
    expect(fs.readFileSync(existingPath, "utf-8")).toBe("existing content");
  });

  describe("Coding Style 语言选择", () => {
    function createCodingStyleTemplates(projectDir: string) {
      const styleDir = path.join(projectDir, "docs", "template", "_coding_style");
      fs.mkdirSync(styleDir, { recursive: true });
      fs.writeFileSync(path.join(styleDir, "typescript.md"), "# TypeScript");
      fs.writeFileSync(path.join(styleDir, "python.md"), "# Python");
      fs.writeFileSync(path.join(styleDir, "general.md"), "# General");
    }

    it("installTemplate 传递 programmingLanguages → 只复制指定语言", () => {
      writeTemplateBundle(tmpDir, "lang-test", "Lang Test");
      createCodingStyleTemplates(tmpDir);

      const languages = ["TypeScript", "Python"];
      installTemplate(tmpDir, "lang-test", languages);

      const codingDir = path.join(tmpDir, "docs", "regulation", "coding_style");
      expect(fs.existsSync(path.join(codingDir, "typescript.md"))).toBe(true);
      expect(fs.existsSync(path.join(codingDir, "python.md"))).toBe(true);
      expect(fs.existsSync(path.join(codingDir, "general.md"))).toBe(false);
    });

    it("installTemplate 不传 programmingLanguages → General 兜底", () => {
      writeTemplateBundle(tmpDir, "lang-fallback", "Lang Fallback");
      createCodingStyleTemplates(tmpDir);

      installTemplate(tmpDir, "lang-fallback");

      const codingDir = path.join(tmpDir, "docs", "regulation", "coding_style");
      expect(fs.existsSync(path.join(codingDir, "general.md"))).toBe(true);
      expect(fs.existsSync(path.join(codingDir, "typescript.md"))).toBe(false);
    });
  });

  describe("DCP 配置文件路径解析", () => {
    const dcpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-pm-test-dcp-"));

    afterEach(() => {
      fs.rmSync(dcpDir, { recursive: true, force: true });
    });

    function setupDcpProject(dir: string) {
      const docsDir = path.join(dir, "docs");
      fs.mkdirSync(path.join(docsDir, "template"), { recursive: true });
      fs.mkdirSync(path.join(docsDir, "flow"), { recursive: true });
      fs.mkdirSync(path.join(docsDir, "regulation"), { recursive: true });
      const opencodeDir = path.join(dir, ".opencode");
      fs.mkdirSync(opencodeDir, { recursive: true });
      fs.writeFileSync(
        path.join(opencodeDir, "package.json"),
        JSON.stringify({
          dependencies: { "opencode-dynamic-context-pruning": "^1.0.0" },
        }),
      );
      writeTemplateBundle(dir, "dcp-test", "DCP Test");
    }

    it("dcp.jsonc 已存在时使用 dcp.jsonc", () => {
      setupDcpProject(dcpDir);
      const jsoncPath = path.join(dcpDir, ".opencode", "dcp.jsonc");
      fs.writeFileSync(jsoncPath, JSON.stringify({ existing: true }));

      installTemplate(dcpDir, "dcp-test");

      const content = JSON.parse(fs.readFileSync(jsoncPath, "utf-8"));
      expect(content.existing).toBe(true);
      expect(content.compress.protectTags).toBe(true);
    });

    it("仅 dcp.json 存在时使用 dcp.json", () => {
      setupDcpProject(dcpDir);
      const jsonPath = path.join(dcpDir, ".opencode", "dcp.json");
      const jsoncPath = path.join(dcpDir, ".opencode", "dcp.jsonc");
      fs.writeFileSync(jsonPath, JSON.stringify({ existing: true }));

      installTemplate(dcpDir, "dcp-test");

      // dcp.json 应被更新
      const content = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
      expect(content.existing).toBe(true);
      expect(content.compress.protectTags).toBe(true);
      // dcp.jsonc 不应被创建
      expect(fs.existsSync(jsoncPath)).toBe(false);
    });

    it("两者都不存在时创建 dcp.jsonc", () => {
      setupDcpProject(dcpDir);
      const jsoncPath = path.join(dcpDir, ".opencode", "dcp.jsonc");

      installTemplate(dcpDir, "dcp-test");

      expect(fs.existsSync(jsoncPath)).toBe(true);
      const content = JSON.parse(fs.readFileSync(jsoncPath, "utf-8"));
      expect(content.compress.protectTags).toBe(true);
    });
  });
});

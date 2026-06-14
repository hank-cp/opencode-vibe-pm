/**
 * Command 文件生成与清理测试
 */

import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  scanTemplates,
  installTemplate,
  uninstallFlow,
  TemplateConflictError,
} from "../../src/template/index.js";

function createTestProject() {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), "vibe-pm-test-cmd-"),
  );
  const docsDir = path.join(dir, "docs");
  fs.mkdirSync(path.join(docsDir, "template"), { recursive: true });
  fs.mkdirSync(path.join(docsDir, "flow"), { recursive: true });
  fs.mkdirSync(path.join(docsDir, "regulation"), { recursive: true });
  return dir;
}

function writeTemplateWithCommand(
  projectDir: string,
  id: string,
  name: string,
  command: string,
  opts?: { inputReqs?: boolean },
) {
  const bundleDir = path.join(projectDir, "docs", "template", id);
  fs.mkdirSync(bundleDir, { recursive: true });

  let content =
    `# ${name}\n\n` +
    `**Template ID**: \`${id}\`\n` +
    `**Category**: development\n` +
    `**Description**: Test template ${id}\n` +
    `**Command**: \`${command}\`\n` +
    `**Version**: 1.0.0\n\n` +
    `---\n\n` +
    `## 适用场景\n\n用于测试命令文件生成的场景。\n\n`;

  if (opts?.inputReqs) {
    content +=
      `## 输入要求\n\n` +
      `| 输入项 | 必填 | 说明 |\n` +
      `|--------|------|------|\n` +
      `| Spec 文档 | 是 | 已存在的规格说明 |\n` +
      `| 调整需求 | 是 | 要改动什么 |\n\n`;
  }

  content +=
    `## 状态机\n\n` +
    `\`\`\`mermaid\nstateDiagram-v2\n    [*] --> S1\n    S1 --> [*]\n\`\`\`\n\n` +
    `## 任务步骤\n\n` +
    `### S1: 测试步骤\n\n**目标**：测试。\n**执行 Agent**：Assistant\n\n1. 测试\n\n**完成后**：结束\n`;

  fs.writeFileSync(path.join(bundleDir, "flow.md"), content);
}

function writeTemplateWithoutCommand(
  projectDir: string,
  id: string,
  name: string,
) {
  const bundleDir = path.join(projectDir, "docs", "template", id);
  fs.mkdirSync(bundleDir, { recursive: true });

  const content =
    `# ${name}\n\n` +
    `**Template ID**: \`${id}\`\n` +
    `**Category**: development\n` +
    `**Description**: Test template ${id}\n` +
    `**Version**: 1.0.0\n\n` +
    `---\n\n` +
    `## 适用场景\n\n无命令模板。\n\n` +
    `## 任务步骤\n\n### S1: 测试\n\n**目标**：测试。\n**执行 Agent**：Assistant\n\n1. 测试\n\n**完成后**：结束\n`;

  fs.writeFileSync(path.join(bundleDir, "flow.md"), content);
}

describe("Command File Generation", () => {
  let testDir: string;

  afterEach(() => {
    if (testDir) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("parse_meta_includes_command: TemplateMeta 包含 command 字段", () => {
    testDir = createTestProject();
    writeTemplateWithCommand(testDir, "test-cmd", "测试命令", "/pm-test-cmd");

    const templates = scanTemplates(testDir);
    expect(templates).toHaveLength(1);
    expect(templates[0].command).toBe("/pm-test-cmd");
    expect(templates[0].id).toBe("test-cmd");
    expect(templates[0].name).toBe("测试命令");
  });

  it("parse_meta_no_command: 无 Command 字段时 command 为空字符串", () => {
    testDir = createTestProject();
    writeTemplateWithoutCommand(testDir, "no-cmd", "无命令");

    const templates = scanTemplates(testDir);
    expect(templates).toHaveLength(1);
    expect(templates[0].command).toBe("");
  });

  it("install_generates_command_file: installTemplate 创建 command 文件", () => {
    testDir = createTestProject();
    writeTemplateWithCommand(testDir, "test-cmd", "测试命令", "/pm-test-cmd", {
      inputReqs: true,
    });

    installTemplate(testDir, "test-cmd");

    const cmdPath = path.join(
      testDir,
      ".opencode",
      "commands",
      "pm-test-cmd.md",
    );
    expect(fs.existsSync(cmdPath)).toBe(true);

    const content = fs.readFileSync(cmdPath, "utf-8");
    expect(content).toContain("# 测试命令");
    expect(content).toContain("## 任务启动");
    expect(content).toContain("`/pm-test-cmd`");
    expect(content).toContain("自动创建任务");
    expect(content).toContain("注入 Flow 步骤指导");
    expect(content).toContain("/pm-task-start");
  });

  it("install_without_command_skips_file: 无 Command 字段时不生成文件", () => {
    testDir = createTestProject();
    writeTemplateWithoutCommand(testDir, "no-cmd", "无命令");

    installTemplate(testDir, "no-cmd");

    const cmdDir = path.join(testDir, ".opencode", "commands");
    expect(fs.existsSync(cmdDir)).toBe(false);
  });

  it("uninstall_removes_command_file: uninstallFlow 同时删除 command 文件", () => {
    testDir = createTestProject();
    writeTemplateWithCommand(
      testDir,
      "test-cmd",
      "测试命令",
      "/pm-test-cmd",
    );

    installTemplate(testDir, "test-cmd");

    const cmdPath = path.join(
      testDir,
      ".opencode",
      "commands",
      "pm-test-cmd.md",
    );
    expect(fs.existsSync(cmdPath)).toBe(true);

    uninstallFlow(testDir, "test-cmd");

    // Flow 文件已删除
    const flowPath = path.join(
      testDir,
      "docs",
      "flow",
      "[flow]test-cmd.md",
    );
    expect(fs.existsSync(flowPath)).toBe(false);

    // Command 文件也已删除
    expect(fs.existsSync(cmdPath)).toBe(false);
  });

  it("generated_command_content_structure: 命令文件包含完整结构", () => {
    testDir = createTestProject();
    writeTemplateWithCommand(
      testDir,
      "struct-test",
      "结构测试",
      "/pm-struct-test",
      { inputReqs: true },
    );

    installTemplate(testDir, "struct-test");

    const cmdPath = path.join(
      testDir,
      ".opencode",
      "commands",
      "pm-struct-test.md",
    );
    const content = fs.readFileSync(cmdPath, "utf-8");
    const lines = content.split("\n");

    // 标题
    expect(lines[0]).toBe("# 结构测试");

    // 任务启动 section
    expect(content).toContain("## 任务启动");
    expect(content).toContain("自动创建任务");

    expect(content).toContain("/pm-task-start");
  });
});

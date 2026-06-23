import { describe, it, expect, beforeAll, afterAll, mock } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { VibePMPlugin } from "../../src/core/plugin.js";
import type { PluginInput } from "../../src/core/types.js";

function mockInput(dir: string): PluginInput {
  return {
    directory: dir,
    worktree: dir,
    serverUrl: new URL("http://localhost"),
    client: {
      session: {
        message: mock(() => Promise.resolve({
          data: { parts: [{ type: "text", text: "test user request" }] },
        })),
      },
    } as any,
    project: {} as PluginInput["project"],
    experimental_workspace: { register: () => {} },
    $: {} as PluginInput["$"],
  };
}

function makeTransformOutput(messages: { role: string; sessionID: string; parts: { type: string; text: string }[] }[]) {
  return {
    messages: messages.map((m, i) => ({
      info: { role: m.role, sessionID: m.sessionID, id: `msg-${i}` },
      parts: [...m.parts],
    })),
  };
}

describe("VibePMPlugin", () => {
  let tmpDir: string;
  let hooks: Awaited<ReturnType<typeof VibePMPlugin>>;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-pm-test-"));
    fs.mkdirSync(path.join(tmpDir, "docs", "flow"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "docs", "flow", "test-flow.md"),
      "**Command**: `/pm-test`\n# Test Flow\n\n## S1\n\n**完成后**: S2\n\n## S2\n\n**完成后**: [*]\n",
    );
    hooks = await VibePMPlugin(mockInput(tmpDir));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("registers config, tool, messages.transform, event", () => {
    expect(typeof hooks.config).toBe("function");
    expect(typeof hooks.tool).toBe("object");
    expect(typeof hooks["experimental.chat.messages.transform"]).toBe("function");
    expect(typeof hooks.event).toBe("function");
  });

  it("injects protect when active task exists", async () => {
    // Use the flow tool to create a task (通过 pm_{flow} 工具，而非已移除的 pm_task_start）
    const tools = hooks.tool as Record<string, { execute: (args: unknown, ctx: unknown) => Promise<string> }>;
    const createResult = await tools.pm_test_flow.execute(
      { summary: "test task" },
      { sessionID: "s1", messageID: "msg-1" },
    );
    const parsed = JSON.parse(createResult);
    expect(parsed.ok).toBe(true);

    const output = makeTransformOutput([
      { role: "user", sessionID: "s1", parts: [{ type: "text", text: "<auto-slash-command>\n/pm-test start\n</auto-slash-command>" }] },
    ]);
    await hooks["experimental.chat.messages.transform"]!(
      {}, output as Parameters<NonNullable<typeof hooks["experimental.chat.messages.transform"]>>[1],
    );
    const parts = output.messages[0].parts as { type: string; text: string; synthetic?: boolean }[];
    expect(parts.length).toBe(2);
    expect(parts[1].type).toBe("text");
    expect(parts[1].text).toContain("<protect>");
    expect(parts[1].synthetic).toBe(true);

    // Clean up
    await tools.pm_task_close.execute(
      {},
      { sessionID: "s1", messageID: "msg-1" },
    );
  });

  it("skips when no auto-slash-command", async () => {
    const output = makeTransformOutput([
      { role: "user", sessionID: "s2", parts: [{ type: "text", text: "hello" }] },
    ]);
    await hooks["experimental.chat.messages.transform"]!(
      {}, output as Parameters<NonNullable<typeof hooks["experimental.chat.messages.transform"]>>[1],
    );
    expect(output.messages[0].parts.length).toBe(1);
  });

  it("clears stale control prompt when no flow cmd", async () => {
    const output = makeTransformOutput([
      { role: "user", sessionID: "s3", parts: [
        { type: "text", text: "hello" },
        { type: "text", text: "<protect>\nold\n</protect>" },
      ]},
    ]);
    await hooks["experimental.chat.messages.transform"]!(
      {}, output as Parameters<NonNullable<typeof hooks["experimental.chat.messages.transform"]>>[1],
    );
    expect(output.messages[0].parts.length).toBe(1);
  });

  it("injects_protect_when_active_task_exists: 有活跃任务时注入 protect", async () => {
    const tools = hooks.tool as Record<string, { execute: (args: unknown, ctx: unknown) => Promise<string> }>;

    const createResult = await tools.pm_test_flow.execute(
      { summary: "dedup test" },
      { sessionID: "sd", messageID: "msg-d" },
    );
    expect(JSON.parse(createResult).ok).toBe(true);

    const cmd = "<auto-slash-command>\n/pm-test dedup\n</auto-slash-command>";
    const o1 = makeTransformOutput([{ role: "user", sessionID: "sd", parts: [{ type: "text", text: cmd }] }]);
    await hooks["experimental.chat.messages.transform"]!({}, o1 as Parameters<NonNullable<typeof hooks["experimental.chat.messages.transform"]>>[1]);
    expect(o1.messages[0].parts.length).toBe(2);

    const o2 = makeTransformOutput([{ role: "user", sessionID: "sd", parts: [{ type: "text", text: cmd }] }]);
    await hooks["experimental.chat.messages.transform"]!({}, o2 as Parameters<NonNullable<typeof hooks["experimental.chat.messages.transform"]>>[1]);
    expect(o2.messages[0].parts.length).toBe(2);

    // Clean up
    await tools.pm_task_close.execute({}, { sessionID: "sd", messageID: "msg-d" });
  });
});

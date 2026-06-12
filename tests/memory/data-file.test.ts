/**
 * 数据文件测试 — AxioDB 单实例，整个文件共享 MemorySystem
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { MemorySystem } from "../../src/memory/memory-system.js";

describe("Data File", () => {
  let tmpDir: string;
  let memory: MemorySystem;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-pm-test-df-"));
    memory = new MemorySystem();
    await memory.init(tmpDir);
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("init_creates_data_on_first_run: 首次运行创建数据目录", () => {
    const dbDir = path.join(tmpDir, "vibe-pm");
    expect(fs.existsSync(dbDir)).toBe(true);
    const appDir = path.join(dbDir, "vibe-pm");
    expect(fs.existsSync(appDir)).toBe(true);
  });

  it("can_create_and_query_after_init: init 后可以正常 CRUD", async () => {
    const task = await memory.createTask({
      sessionId: "ses_df_test",
      flow: "test-flow",
      currentStep: "S1",
      currentStepName: "测试",
      startAt: new Date().toISOString(),
      summary: "验证 init 后可用",
    });
    expect(task.sessionId).toBe("ses_df_test");
    const fetched = await memory.getTask("ses_df_test");
    expect(fetched).toBeDefined();
  });
});

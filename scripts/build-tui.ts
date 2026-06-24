/**
 * vibe-pm 构建脚本
 *
 * 统一使用 Bun.build() API：
 * - Server 插件：纯 TS，无需 JSX 插件
 * - TUI 插件：需 @opentui/solid/bun-plugin 转换 SolidJS JSX
 * - external @opentui/* 和 solid-js：共享 OpenTUI 运行时的渲染器实例
 */
import solidPlugin from "@opentui/solid/bun-plugin";
import * as fs from "node:fs";
import * as path from "node:path";

const shared = {
  target: "bun" as const,
  format: "esm" as const,
  external: [
    "@opentui/core",
    "@opentui/solid",
    "@opentui/keymap",
    "solid-js",
    "@opencode-ai/plugin",
  ],
};

// ─── Server Plugin ───
const serverResult = await Bun.build({
  ...shared,
  entrypoints: ["./src/index.ts"],
  outdir: "./dist",
  naming: { entry: "index.js" },
});

if (!serverResult.success) {
  console.error("[vibe-pm] Server build failed:");
  for (const log of serverResult.logs) console.error(log);
  process.exit(1);
}
for (const o of serverResult.outputs) {
  console.error(`[vibe-pm] Server: ${o.path} (${o.size} bytes)`);
}

// ─── 复制内置模板到 dist/ ───
{
  const srcDir = path.resolve(import.meta.dirname, "../docs/template");
  const destDir = path.resolve(import.meta.dirname, "../dist/docs/template");

  if (fs.existsSync(srcDir)) {
    fs.mkdirSync(destDir, { recursive: true });
    fs.cpSync(srcDir, destDir, { recursive: true });
    const count = countFiles(destDir);
    console.error(`[vibe-pm] Copied templates: ${srcDir} → ${destDir} (${count} files)`);
  } else {
    console.error("[vibe-pm] WARNING: docs/template/ not found, plugins will not have built-in templates");
  }
}

function countFiles(dir: string): number {
  let n = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) n += countFiles(path.join(dir, entry.name));
    else n++;
  }
  return n;
}

// ─── TUI Plugin ───
const tuiResult = await Bun.build({
  ...shared,
  entrypoints: ["./src/tui/index.ts"],
  outdir: "./dist/tui",
  plugins: [solidPlugin],
  naming: { entry: "index.js" },
});

if (!tuiResult.success) {
  console.error("[vibe-pm] TUI build failed:");
  for (const log of tuiResult.logs) console.error(log);
  process.exit(1);
}
for (const o of tuiResult.outputs) {
  console.error(`[vibe-pm] TUI: ${o.path} (${o.size} bytes)`);
}

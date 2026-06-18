/**
 * Post-install: 修补 @opentui/solid 的 package.json exports，
 * 为 jsx-runtime 添加 .js 回退（原包仅有 .d.ts 类型声明）。
 *
 * 背景: @opentui/solid 将 jsx-runtime 仅映射到类型声明，
 * 导致 Bun 加载 .jsx 文件时无法找到 jsx/jsxs/jsxDEV 运行时导出。
 * 此脚本将 exports 改为同时映射 .js 实现，配合 scripts/opentui-jsx-runtime.js
 * 使用（该文件也需要复制到 @opentui/solid 目录下）。
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SHIM_SRC = "scripts/opentui-jsx-runtime.js";
const SHIM_DST = "jsx-runtime.js";

function patch(dir) {
  const pkgPath = join(dir, "package.json");
  if (!existsSync(pkgPath)) return;
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  if (!pkg.exports?.["./jsx-runtime"]) return;

  // Copy shim
  copyFileSync(SHIM_SRC, join(dir, SHIM_DST));

  // Patch exports
  if (typeof pkg.exports["./jsx-runtime"] === "string" || !pkg.exports["./jsx-runtime"].default) {
    pkg.exports["./jsx-runtime"] = {
      types: "./jsx-runtime.d.ts",
      default: "./jsx-runtime.js",
    };
    pkg.exports["./jsx-dev-runtime"] = {
      types: "./jsx-runtime.d.ts",
      default: "./jsx-runtime.js",
    };
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
    console.log(`  patched: ${pkgPath}`);
  } else {
    console.log(`  already patched: ${pkgPath}`);
  }
}

// Patch node_modules/@opentui/solid
const root = join("node_modules", "@opentui", "solid");
if (existsSync(root)) patch(root);

// Patch all .pnpm copies
const pnpmDir = join("node_modules", ".pnpm");
if (existsSync(pnpmDir)) {
  for (const entry of readdirSync(pnpmDir, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith("@opentui+solid@")) {
      patch(join(pnpmDir, entry.name, "node_modules", "@opentui", "solid"));
    }
  }
}

console.log("[patch-opentui-jsx-runtime] Done.");

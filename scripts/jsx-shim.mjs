/**
 * Post-build: 为 dist/ 下每个 .jsx 文件生成对应的 .js 重导出 shim。
 *
 * 背景：tsconfig 配置 "jsx": "preserve" 导致 .tsx 编译产物为 .jsx，
 * 但源码中的 import 路径使用 .js 扩展名。OpenCode 的 Bun 运行时
 * 通过内部插件提供 JSX 转换，因此 .jsx 文件在 OpenCode 内可正常运行，
 * 但 .js 路径仍需解析到实际 .jsx 文件。此脚本为每个 .jsx 生成对应的
 * .js 重导出文件，确保两种扩展名的 import 均能解析。
 */
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
    } else if (entry.name.endsWith(".jsx")) {
      const shimPath = full.replace(/\.jsx$/, ".js");
      writeFileSync(shimPath, `export * from "./${entry.name}";\n`);
      console.log(`  shim: ${shimPath}`);
    }
  }
}

console.log("[jsx-shim] Generating .js shims for .jsx files...");
walk("dist");
console.log("[jsx-shim] Done.");

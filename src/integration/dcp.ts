import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

/**
 * 写入 DCP 保护配置（protectTags + protectedFilePatterns）
 *
 * 检测 opencode.json/opencode.jsonc 中是否有 plugin 配置，
 * 项目级和全局级均检查，有则继续写入。
 */
export function writeDcpConfig(projectDir: string): void {
  const configPaths = [
    path.join(projectDir, '.opencode', 'opencode.json'),
    path.join(projectDir, '.opencode', 'opencode.jsonc'),
    path.join(os.homedir(), '.config', 'opencode', 'opencode.json'),
    path.join(os.homedir(), '.config', 'opencode', 'opencode.jsonc'),
  ];

  let hasPluginConfig = false;
  for (const cfgPath of configPaths) {
    try {
      if (!fs.existsSync(cfgPath)) continue;
      const raw = fs.readFileSync(cfgPath, 'utf-8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (Array.isArray(parsed.plugin) && parsed.plugin.length > 0) {
        hasPluginConfig = true;
        break;
      }
    } catch {
      continue;
    }
  }

  if (!hasPluginConfig) return;

  const jsoncPath = path.join(projectDir, '.opencode', 'dcp.jsonc');
  const jsonPath = path.join(projectDir, '.opencode', 'dcp.json');
  const dcpPath = fs.existsSync(jsoncPath)
    ? jsoncPath
    : fs.existsSync(jsonPath)
      ? jsonPath
      : jsoncPath;
  const newProtect = {
    compress: { protectTags: true },
    protectedFilePatterns: ['docs/flow/*', 'docs/regulation/*', 'docs/spec/*'],
  };

  let existing: Record<string, unknown> = {};
  if (fs.existsSync(dcpPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(dcpPath, 'utf-8'));
    } catch {
      // 解析失败则覆盖
    }
  }

  const existingCompress =
    existing.compress != null && typeof existing.compress === 'object'
      ? (existing.compress as Record<string, unknown>)
      : {};
  const existingPatterns = Array.isArray(existing.protectedFilePatterns)
    ? (existing.protectedFilePatterns as string[])
    : [];

  const existingPT: unknown = existingCompress.protectTags;
  const newPT: unknown = newProtect.compress.protectTags;
  const mergedPT: boolean | string[] =
    newPT === true || existingPT === true
      ? true
      : [
          ...new Set([
            ...(Array.isArray(existingPT) ? existingPT : []),
            ...(Array.isArray(newPT) ? newPT : []),
          ]),
        ];

  const merged = {
    ...existing,
    compress: {
      ...(existing.compress as Record<string, unknown>),
      protectTags: mergedPT,
    },
    protectedFilePatterns: [...new Set([...existingPatterns, ...newProtect.protectedFilePatterns])],
  };

  const dir = path.dirname(dcpPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(dcpPath, JSON.stringify(merged, null, 2), 'utf-8');
}

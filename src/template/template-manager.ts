/**
 * Template Manager
 *
 * 纯文件操作模块：模板扫描、安装（含 command 文件生成、regulation 自动安装）、卸载（含 command 文件清理）。
 * 零外部依赖，按约定路径读写文件系统。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { TemplateMeta } from "./types.js";

// ─── 约定路径 ───

const TEMPLATE_DIR = "template";
const FLOW_DIR = "flow";
const REGULATION_DIR = "regulation";
const COMMANDS_DIR = ".opencode/commands";
const CODING_STYLE_TEMPLATE = "coding-style-template.md";
const CODING_STYLE_OUTPUT = "coding_style.md";
const CONSTITUTION_TEMPLATE = "constitution-template.md";
const CONSTITUTION_OUTPUT = "constitution.md";
const DICTIONARY_TEMPLATE = "dictionary-template.md";
const DICTIONARY_OUTPUT = "dictionary.md";

// ─── 错误 ───

export class TemplateConflictError extends Error {
  constructor(flowName: string) {
    super(
      `Flow "${flowName}" already exists in /docs/flow/. Use --force to overwrite.`,
    );
    this.name = "TemplateConflictError";
  }
}

// ─── 内部辅助 ───

function getDocsDir(projectDir: string): string {
  return path.join(projectDir, "docs");
}

function getCommandsDir(projectDir: string): string {
  return path.join(projectDir, COMMANDS_DIR);
}

function stripLeadingSlash(command: string): string {
  return command.startsWith("/") ? command.slice(1) : command;
}

function parseTemplateMeta(raw: string, bundleDir: string): TemplateMeta | null {
  const idMatch = raw.match(/\*\*Template ID\*\*:\s*`(.+?)`/);
  const nameMatch = raw.match(/^#\s+(.+)/m);
  const catMatch = raw.match(/\*\*Category\*\*:\s*(.+)/);
  const descMatch = raw.match(/\*\*Description\*\*:\s*(.+)/);
  const verMatch = raw.match(/\*\*Version\*\*:\s*(.+)/);
  const cmdMatch = raw.match(/\*\*Command\*\*:\s*`?(.+?)`?\s*$/m);

  if (!idMatch || !nameMatch) return null;

  return {
    id: idMatch[1].trim(),
    name: nameMatch[1].trim(),
    category: catMatch?.[1]?.trim() ?? "",
    description: descMatch?.[1]?.trim() ?? "",
    version: verMatch?.[1]?.trim() ?? "1.0.0",
    command: cmdMatch?.[1]?.trim() ?? "",
    flowPath: path.join(bundleDir, "flow.md"),
    bundleDir,
  };
}

function generateCommandFile(meta: TemplateMeta): string {
  const flowRef = `docs/flow/[flow]${meta.id}.md`;
  return [
    `# ${meta.name}`,
    ``,
    `## 流程控制`,
    ``,
    `当触发 \`${meta.command}\` 命令时，系统将注入文件引用标签。`,
    ``,
    `流程文件：\`${flowRef}\``,
  ].join("\n") + "\n";
}

// ─── 语言检测 ───

interface LanguageDetector {
  files: string[];
  packages?: string[];
}

const LANGUAGE_DETECTORS: Record<string, LanguageDetector> = {
  TypeScript: {
    files: ["tsconfig.json"],
    packages: ["typescript"],
  },
  JavaScript: {
    files: ["package.json"],
    packages: [],
  },
  Python: {
    files: ["pyproject.toml", "setup.py", "setup.cfg", "requirements.txt", "Pipfile"],
  },
  Rust: {
    files: ["Cargo.toml"],
  },
  Go: {
    files: ["go.mod"],
  },
  Java: {
    files: ["pom.xml", "build.gradle", "build.gradle.kts"],
  },
  Kotlin: {
    files: ["build.gradle.kts"],
    packages: [],
  },
  Ruby: {
    files: ["Gemfile"],
  },
  Elixir: {
    files: ["mix.exs"],
  },
  "C/C++": {
    files: ["CMakeLists.txt", "Makefile"],
  },
};

/**
 * 检测项目使用的主要语言。
 * TypeScript 会覆盖 JavaScript（同时检测到时）。
 */
function detectProjectLanguages(projectDir: string): string[] {
  const detected: string[] = [];

  for (const [lang, detector] of Object.entries(LANGUAGE_DETECTORS)) {
    const hasFile = detector.files.some((f) =>
      fs.existsSync(path.join(projectDir, f)),
    );

    if (!hasFile) continue;

    if (detector.packages && detector.packages.length > 0) {
      const packageJsonPath = path.join(projectDir, "package.json");
      if (fs.existsSync(packageJsonPath)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
          const deps = {
            ...(pkg.devDependencies ?? {}),
            ...(pkg.dependencies ?? {}),
          };
          const hasPackage = detector.packages.some((p) => p in deps);
          if (!hasPackage) continue;
        } catch {
          continue;
        }
      } else {
        continue;
      }
    }

    detected.push(lang);
  }

  // TypeScript 覆盖 JavaScript（同时检测到时）
  if (detected.includes("TypeScript") && detected.includes("JavaScript")) {
    return detected.filter((l) => l !== "JavaScript");
  }

  return detected;
}

// ─── 编码风格模板生成 ───

interface LanguageDefaults {
  formatter: string;
  indent: string;
  maxLineLength: number;
  lineEndings: string;
  fileNaming: string;
  dirNaming: string;
  testFilePattern: string;
  fileOrganizationNotes: string;
  importOrderGuide: string;
  fileStructureNotes: string;
  varNaming: string;
  constNaming: string;
  constNamingNotes: string;
  funcNaming: string;
  typeNaming: string;
  typeNamingNotes: string;
  classNaming: string;
  enumGuide: string;
  typeSafetyRules: string;
  maxParams: number;
  paramDesignNotes: string;
  resultType: string;
  controlFlowGuide: string;
  asyncGuide: string;
  errorHandlingGuide: string;
  loggingGuide: string;
  commentGuide: string;
  placeholderFormat: string;
  exportGuide: string;
}

const LANGUAGE_DEFAULTS: Record<string, LanguageDefaults> = {
  TypeScript: {
    formatter: "Prettier",
    indent: "2 空格，不使用 Tab",
    maxLineLength: 100,
    lineEndings: "",
    fileNaming: "`kebab-case` 或 `camelCase`，与所在模块保持一致",
    dirNaming: "`kebab-case`",
    testFilePattern: "`*.test.ts` 或 `*.spec.ts`，与被测文件同目录",
    fileOrganizationNotes: "",
    importOrderGuide: `\`\`\`typescript
// 1. Node 内置模块
import * as fs from 'node:fs';
import * as path from 'node:path';

// 2. 第三方库
import axios from 'axios';
import { z } from 'zod';

// 3. 项目内部模块（使用相对路径或别名）
import { TaskState } from '../state/task-state';
import { FlowParser } from './flow-parser';
\`\`\``,
    fileStructureNotes: "",
    varNaming: "`camelCase`",
    constNaming: "`UPPER_SNAKE_CASE`（模块级）/ `camelCase`（函数内）",
    constNamingNotes: "",
    funcNaming: "`camelCase`",
    typeNaming: "`PascalCase`",
    typeNamingNotes: "接口名不加 `I` 前缀，类型别名不加 `T` 前缀",
    classNaming: "`PascalCase`，单数形式",
    enumGuide: `使用 \`PascalCase\`，成员使用 \`PascalCase\`

\`\`\`typescript
enum TaskStatus {
  Running = 'running',
  Completed = 'completed',
  Closed = 'closed',
}
\`\`\``,
    typeSafetyRules: `### 禁止事项

\`\`\`typescript
// ❌ 禁止 any
function process(data: any): any { }

// ❌ 禁止 @ts-ignore / @ts-expect-error
// @ts-ignore
const x = something;

// ❌ 禁止空 catch
try { } catch (e) { }

// ❌ 禁止非空断言滥用
const x = data!.value!;
\`\`\`

### 推荐方式

\`\`\`typescript
// ✅ 使用 unknown 代替 any
function process(data: unknown): Result {
  if (!isValidData(data)) throw new TypeError('Invalid data');
}

// ✅ 类型守卫
function isValidData(data: unknown): data is ValidData {
  return typeof data === 'object' && data !== null && 'id' in data;
}

// ✅ 显式错误处理
try {
  await riskyOperation();
} catch (e) {
  logger.error('Operation failed', { error: String(e) });
  throw new OperationError('Failed', { cause: e });
}
\`\`\``,
    maxParams: 3,
    paramDesignNotes: "",
    resultType: "`Result<T, E>` 模式或 `Option<T>`",
    controlFlowGuide: "",
    asyncGuide: `- 统一使用 \`async/await\`，避免原始 Promise
- 异步函数返回 \`Promise<T>\`，类型明确
- 顶层 async 使用 IIFE 或 \`.catch()\` 兜底

\`\`\`typescript
async function loadTask(sessionId: string): Promise<Task | null> {
  const data = await db.query('SELECT * FROM tasks WHERE session_id = ?', [sessionId]);
  return data ? Task.fromRow(data) : null;
}
\`\`\``,
    errorHandlingGuide: `- 所有错误必须显式处理（传递/包装/处理/终止）
- 在系统边界（用户输入、外部 API）进行校验
- 不在内部逻辑中添加"不可能发生"的错误处理

\`\`\`typescript
try {
  await riskyOperation();
} catch (e) {
  logger.error('Operation failed', { error: String(e) });
  throw new OperationError('Failed to complete operation', { cause: e });
}
\`\`\``,
    loggingGuide: `- 使用项目统一的日志模块（不直接用 \`console.log\`）
- 日志消息使用英文
- 关键路径记录 info/debug 日志

\`\`\`typescript
logger.info('Task created', { sessionId, flow });
logger.error('Failed to load task', { sessionId, error: String(e) });
\`\`\``,
    commentGuide: `- 代码注释使用英文
- 公共 API 使用 JSDoc 注释
- 复杂逻辑添加解释性注释`,
    placeholderFormat: `\`\`\`typescript
// TODO(username): 需要对接 API — 预计 v1.1
// FIXME(username): 并发场景下可能数据竞争 — 需要加锁
// HACK(username): 临时绕过限制 — v1.0 后替换
\`\`\``,
    exportGuide: `\`\`\`typescript
// 主要导出
export class FlowParser { }

// 辅助类型/函数使用命名导出
export interface FlowDefinition { }
export function parseFlow(path: string): FlowDefinition { }

// 内部实现不导出
function validateStep(step: unknown): step is StepDefinition { }
\`\`\``,
  },

  Python: {
    formatter: "Black + isort",
    indent: "4 空格，不使用 Tab",
    maxLineLength: 88,
    lineEndings: "",
    fileNaming: "`snake_case`",
    dirNaming: "`snake_case`",
    testFilePattern: "`test_*.py` 或 `*_test.py`",
    fileOrganizationNotes: "",
    importOrderGuide: `\`\`\`python
# 1. 标准库
import os
from pathlib import Path

# 2. 第三方库
import requests
from pydantic import BaseModel

# 3. 项目内部模块
from app.core.config import settings
from app.models.user import User
\`\`\``,
    fileStructureNotes: "",
    varNaming: "`snake_case`",
    constNaming: "`UPPER_SNAKE_CASE`",
    constNamingNotes: "",
    funcNaming: "`snake_case`",
    typeNaming: "`PascalCase`",
    typeNamingNotes: "遵循 PEP 8，类名使用 CapWords",
    classNaming: "`PascalCase`",
    enumGuide: `使用 \`Enum\`，成员使用 \`UPPER_SNAKE_CASE\`

\`\`\`python
from enum import Enum

class TaskStatus(Enum):
    RUNNING = "running"
    COMPLETED = "completed"
    CLOSED = "closed"
\`\`\``,
    typeSafetyRules: `### 推荐方式

\`\`\`python
# ✅ 使用类型注解
def process(data: dict[str, object]) -> Result:
    if not isinstance(data, dict) or "id" not in data:
        raise TypeError("Invalid data")
    ...

# ✅ 使用 mypy / pyright 进行静态检查
# ✅ 使用 dataclass / Pydantic 定义数据结构
from dataclasses import dataclass

@dataclass
class TaskState:
    session_id: str
    flow: str
    current_step: str
\`\`\`

### 禁止事项

- ❌ 禁止裸 except（至少捕获 Exception）
- ❌ 禁止在生产代码中使用 print() 代替日志
- ❌ 禁止可变默认参数`,
    maxParams: 3,
    paramDesignNotes: "",
    resultType: "`Result` 模式（如 returns 库）或 `Optional[T]`",
    controlFlowGuide: "",
    asyncGuide: `- 使用 \`async/await\`（asyncio）
- 异步函数使用 \`async def\`
- 避免混用同步/异步代码

\`\`\`python
async def load_task(session_id: str) -> Task | None:
    data = await db.fetch_one("SELECT * FROM tasks WHERE session_id = ?", session_id)
    return Task.from_row(data) if data else None
\`\`\``,
    errorHandlingGuide: `- 明确捕获异常类型，不使用裸 \`except:\`
- 在系统边界进行输入校验
- 使用自定义异常类

\`\`\`python
try:
    result = await risky_operation()
except ConnectionError as e:
    logger.error("Operation failed", extra={"error": str(e)})
    raise OperationError("Failed to complete operation") from e
\`\`\``,
    loggingGuide: `- 使用 \`logging\` 模块，不直接用 \`print()\`
- 日志消息使用英文
- 关键路径记录 info/debug 日志

\`\`\`python
import logging

logger = logging.getLogger(__name__)
logger.info("Task created", extra={"session_id": session_id})
logger.error("Failed to load task", extra={"error": str(e)})
\`\`\``,
    commentGuide: `- 代码注释使用英文
- 公共 API 使用 docstring（Google 或 NumPy 风格）
- 复杂逻辑添加解释性注释`,
    placeholderFormat: `\`\`\`python
# TODO(username): 需要对接 API — 预计 v1.1
# FIXME(username): 并发场景下可能数据竞争 — 需要加锁
# HACK(username): 临时绕过限制 — v1.0 后替换
\`\`\``,
    exportGuide: `\`\`\`python
# __init__.py 中控制导出
__all__ = ["FlowParser", "parse_flow", "FlowDefinition"]

# 主要导出
class FlowParser: ...

# 辅助函数使用命名导出
def parse_flow(path: str) -> FlowDefinition: ...
\`\`\``,
  },

  Go: {
    formatter: "gofmt / goimports",
    indent: "Tab",
    maxLineLength: 120,
    lineEndings: "",
    fileNaming: "`snake_case`（小写 + 下划线）",
    dirNaming: "`snake_case`（小写，简短）",
    testFilePattern: "`*_test.go`，与被测文件同目录",
    fileOrganizationNotes: "包名使用简短小写单词，避免下划线。",
    importOrderGuide: `\`\`\`go
import (
    // 1. 标准库
    "fmt"
    "os"

    // 2. 第三方库
    "github.com/gin-gonic/gin"

    // 3. 项目内部包
    "example.com/project/internal/models"
)
\`\`\``,
    fileStructureNotes: "一个目录一个包，包名与目录名一致。",
    varNaming: "`camelCase`（导出：`PascalCase`）",
    constNaming: "`PascalCase` 或 `camelCase`（导出：`PascalCase`）",
    constNamingNotes: "Go 不使用 UPPER_SNAKE_CASE。",
    funcNaming: "`camelCase`（导出：`PascalCase`）",
    typeNaming: "`PascalCase`",
    typeNamingNotes: "接口名通常以 `-er` 结尾（如 `Reader`, `Writer`）。",
    classNaming: "Go 没有类，使用 `PascalCase` 命名 struct。",
    enumGuide: `Go 没有原生枚举，使用 \`const\` + \`iota\`：

\`\`\`go
type TaskStatus int

const (
    TaskStatusRunning TaskStatus = iota
    TaskStatusCompleted
    TaskStatusClosed
)
\`\`\``,
    typeSafetyRules: `### 规则

- ✅ 使用强类型，避免 \`interface{}\`（优先使用泛型或具体类型）
- ✅ 显式错误处理：每个可能失败的调用都检查 \`if err != nil\`
- ✅ 使用 \`go vet\` 和 \`staticcheck\` 进行静态分析
- ❌ 禁止忽略错误返回值`,
    maxParams: 3,
    paramDesignNotes: "",
    resultType: "`(T, error)` 元组",
    controlFlowGuide: `- 优先使用提前返回（early return），减少嵌套
- \`switch\` 不需要 \`break\`，使用 \`fallthrough\` 明确穿透`,
    asyncGuide: `- 使用 goroutine + channel 进行并发
- 使用 \`context.Context\` 传递取消信号和超时
- 使用 \`sync.WaitGroup\` / \`errgroup\` 管理并发

\`\`\`go
func LoadTask(ctx context.Context, sessionID string) (*Task, error) {
    // ...
}
\`\`\``,
    errorHandlingGuide: `- 每个可能失败的调用都显式处理错误
- 错误信息使用小写开头，不以标点结尾
- 使用 \`fmt.Errorf\` 包装错误

\`\`\`go
data, err := db.Query("SELECT * FROM tasks WHERE session_id = ?", sessionID)
if err != nil {
    return nil, fmt.Errorf("failed to load task: %w", err)
}
\`\`\``,
    loggingGuide: `- 使用结构化日志库（如 \`slog\`、\`zap\`）
- 日志消息使用英文

\`\`\`go
slog.Info("task created", "sessionID", sessionID)
slog.Error("failed to load task", "error", err)
\`\`\``,
    commentGuide: `- 代码注释使用英文
- 导出的类型/函数必须有文档注释（以名称开头）
- 复杂逻辑添加解释性注释`,
    placeholderFormat: `\`\`\`go
// TODO(username): 需要对接 API — 预计 v1.1
// FIXME(username): 并发场景下可能数据竞争 — 需要加锁
// HACK(username): 临时绕过限制 — v1.0 后替换
\`\`\``,
    exportGuide: `- 大写首字母 = 导出（public）
- 小写首字母 = 包内私有（private）
- 避免导出不必要的符号`,
  },

  Rust: {
    formatter: "rustfmt",
    indent: "4 空格，不使用 Tab",
    maxLineLength: 100,
    lineEndings: "",
    fileNaming: "`snake_case`",
    dirNaming: "`snake_case`",
    testFilePattern: "`#[cfg(test)]` 模块内联或 `tests/` 目录",
    fileOrganizationNotes: "",
    importOrderGuide: `\`\`\`rust
// 1. 标准库
use std::collections::HashMap;
use std::path::PathBuf;

// 2. 第三方 crate
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

// 3. 项目内部模块
use crate::core::config::Config;
use crate::models::user::User;
\`\`\``,
    fileStructureNotes: "",
    varNaming: "`snake_case`",
    constNaming: "`UPPER_SNAKE_CASE`",
    constNamingNotes: "静态变量使用 `SCREAMING_SNAKE_CASE`。",
    funcNaming: "`snake_case`",
    typeNaming: "`PascalCase`",
    typeNamingNotes: "trait 名使用 PascalCase，避免 `-able` 后缀。",
    classNaming: "Rust 没有类，struct/enum 使用 `PascalCase`。",
    enumGuide: `使用 \`enum\` + \`#[derive(...)]\`：

\`\`\`rust
#[derive(Debug, Clone, PartialEq)]
enum TaskStatus {
    Running,
    Completed,
    Closed,
}
\`\`\``,
    typeSafetyRules: `### 规则

- ✅ 利用 Rust 的所有权和借用系统，避免不必要的 \`.clone()\`
- ✅ 使用 \`Result<T, E>\` 和 \`Option<T>\` 代替 null
- ✅ 使用 \`clippy\` 进行 lint 检查
- ❌ 禁止使用 \`unsafe\`（除非有充分理由并注释说明）
- ❌ 禁止 \`unwrap()\` 和 \`expect()\` 在生产路径中`,
    maxParams: 3,
    paramDesignNotes: "使用 builder 模式处理复杂构造。",
    resultType: "`Result<T, E>` 和 `Option<T>`",
    controlFlowGuide: `- 使用 \`match\` 进行模式匹配
- 使用 \`if let\` 简化单分支匹配
- 使用 \`?\` 运算符传播错误`,
    asyncGuide: `- 使用 \`tokio\` 运行时
- 异步函数返回 \`impl Future<Output = T>\` 或标注 \`async fn\`

\`\`\`rust
async fn load_task(session_id: &str) -> Result<Option<Task>, DbError> {
    let data = db.query("SELECT * FROM tasks WHERE session_id = ?", session_id).await?;
    Ok(data.map(Task::from_row))
}
\`\`\``,
    errorHandlingGuide: `- 使用 \`thiserror\` 定义错误类型
- 使用 \`?\` 运算符传播错误
- 使用 \`anyhow\` 处理应用级错误

\`\`\`rust
use thiserror::Error;

#[derive(Error, Debug)]
enum AppError {
    #[error("failed to load task: {0}")]
    DbError(#[from] DbError),
}
\`\`\``,
    loggingGuide: `- 使用 \`tracing\` / \`log\` crate
- 日志消息使用英文

\`\`\`rust
tracing::info!(session_id = %session_id, "task created");
tracing::error!(error = %e, "failed to load task");
\`\`\``,
    commentGuide: `- 代码注释使用英文
- 公共 API 使用 \`///\` 文档注释
- 模块使用 \`//!\` 注释`,
    placeholderFormat: `\`\`\`rust
// TODO(username): 需要对接 API — 预计 v1.1
// FIXME(username): 并发场景下可能数据竞争 — 需要加锁
// HACK(username): 临时绕过限制 — v1.0 后替换
\`\`\``,
    exportGuide: `- 使用 \`pub\` 控制可见性
- \`pub(crate)\` 限制 crate 内可见
- 模块通过 \`mod.rs\` 或同名文件组织`,
  },

  Java: {
    formatter: "Spotless / google-java-format",
    indent: "4 空格，不使用 Tab",
    maxLineLength: 120,
    lineEndings: "",
    fileNaming: "`PascalCase`（一个文件一个公共类）",
    dirNaming: "`snake_case` 或按包名约定",
    testFilePattern: "`*Test.java`，在 `src/test/` 下镜像 `src/main/` 结构",
    fileOrganizationNotes: "包名全小写，使用反向域名（如 `com.example.project`）。",
    importOrderGuide: `\`\`\`java
// 1. 静态导入
import static org.junit.Assert.*;

// 2. Java 标准库
import java.util.List;
import java.util.Optional;

// 3. 第三方库
import com.google.common.collect.ImmutableList;

// 4. 项目内部
import com.example.project.core.TaskState;
\`\`\``,
    fileStructureNotes: "每个文件一个顶层类，类名与文件名一致。",
    varNaming: "`camelCase`",
    constNaming: "`UPPER_SNAKE_CASE`（`static final` 字段）",
    constNamingNotes: "",
    funcNaming: "`camelCase`",
    typeNaming: "`PascalCase`",
    typeNamingNotes: "接口名不加 `I` 前缀。",
    classNaming: "`PascalCase`",
    enumGuide: `使用 \`enum\`，成员使用 \`UPPER_SNAKE_CASE\`：

\`\`\`java
public enum TaskStatus {
    RUNNING,
    COMPLETED,
    CLOSED
}
\`\`\``,
    typeSafetyRules: `### 规则

- ✅ 使用泛型避免原始类型
- ✅ 使用 \`Optional<T>\` 代替 null 返回
- ✅ 使用 \`final\` 修饰不可变字段
- ❌ 禁止捕获 \`Exception\` 后吞掉`,
    maxParams: 3,
    paramDesignNotes: "使用 Builder 模式处理复杂构造。",
    resultType: "`Optional<T>` 或自定义 `Result<T, E>`",
    controlFlowGuide: "",
    asyncGuide: `- 使用 \`CompletableFuture<T>\` 或响应式框架
- 异步方法返回 \`Future<T>\`

\`\`\`java
public CompletableFuture<Optional<Task>> loadTask(String sessionId) {
    return db.queryAsync("SELECT * FROM tasks WHERE session_id = ?", sessionId)
        .thenApply(data -> data != null ? Task.fromRow(data) : null);
}
\`\`\``,
    errorHandlingGuide: `- 捕获具体异常类型
- 使用自定义异常类
- 在 finally 中释放资源（或使用 try-with-resources）

\`\`\`java
try {
    var result = riskyOperation();
} catch (IOException e) {
    logger.error("Operation failed", e);
    throw new OperationException("Failed to complete operation", e);
}
\`\`\``,
    loggingGuide: `- 使用 SLF4J + Logback
- 日志消息使用英文

\`\`\`java
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

private static final Logger logger = LoggerFactory.getLogger(TaskService.class);
logger.info("Task created, sessionId={}", sessionId);
logger.error("Failed to load task", e);
\`\`\``,
    commentGuide: `- 代码注释使用英文
- 公共 API 使用 Javadoc
- 复杂逻辑添加解释性注释`,
    placeholderFormat: `\`\`\`java
// TODO(username): 需要对接 API — 预计 v1.1
// FIXME(username): 并发场景下可能数据竞争 — 需要加锁
// HACK(username): 临时绕过限制 — v1.0 后替换
\`\`\``,
    exportGuide: "使用 `public` / `protected` / package-private 控制可见性。",
  },

  General: {
    formatter: "项目约定的格式化工具",
    indent: "项目约定（建议 2 或 4 空格）",
    maxLineLength: 100,
    lineEndings: "",
    fileNaming: "项目约定（建议 `kebab-case` 或 `snake_case`）",
    dirNaming: "项目约定（建议 `kebab-case`）",
    testFilePattern: "项目约定",
    fileOrganizationNotes: "",
    importOrderGuide: "1. 标准库/内置模块\n2. 第三方依赖\n3. 项目内部模块",
    fileStructureNotes: "",
    varNaming: "项目约定（建议 `camelCase` 或 `snake_case`）",
    constNaming: "项目约定（建议 `UPPER_SNAKE_CASE`）",
    constNamingNotes: "",
    funcNaming: "项目约定（建议 `camelCase` 或 `snake_case`）",
    typeNaming: "项目约定（建议 `PascalCase`）",
    typeNamingNotes: "接口/类型名不加前缀。",
    classNaming: "项目约定（建议 `PascalCase`）",
    enumGuide: "项目约定",
    typeSafetyRules: `- 避免使用动态类型/任意类型
- 优先使用类型注解/类型提示
- 显式错误处理，不吞掉异常`,
    maxParams: 3,
    paramDesignNotes: "",
    resultType: "项目约定（如 `Result<T, E>`、`Optional<T>`、`(T, error)`）",
    controlFlowGuide: "优先使用提前返回，减少嵌套层级。",
    asyncGuide: "使用语言/框架推荐的异步模式。",
    errorHandlingGuide: `- 所有错误必须显式处理
- 在系统边界进行输入校验
- 不在内部逻辑中添加"不可能发生"的错误处理`,
    loggingGuide: `- 使用项目统一的日志模块
- 日志消息使用英文
- 关键路径记录 info/debug 日志`,
    commentGuide: `- 代码注释使用英文
- 公共 API 添加文档注释
- 复杂逻辑添加解释性注释`,
    placeholderFormat: `\`\`\`
// TODO(username): 需要对接 API — 预计 v1.1
// FIXME(username): 并发场景下可能数据竞争 — 需要加锁
// HACK(username): 临时绕过限制 — v1.0 后替换
\`\`\``,
    exportGuide: "使用语言/框架推荐的可见性控制。",
  },
};

function generateCodingStyle(docsDir: string, languages: string[]): string | null {
  const templatePath = path.join(docsDir, TEMPLATE_DIR, CODING_STYLE_TEMPLATE);
  if (!fs.existsSync(templatePath)) return null;

  const primaryLang = languages.length > 0 ? languages[0] : "General";
  const defaults =
    LANGUAGE_DEFAULTS[primaryLang] ?? LANGUAGE_DEFAULTS["General"];

  let template = fs.readFileSync(templatePath, "utf-8");

  template = template.replace(/\{LANGUAGE\}/g, primaryLang);
  template = template.replace(/\{FORMATTER\}/g, defaults.formatter);
  template = template.replace(/\{INDENT\}/g, defaults.indent);
  template = template.replace(
    /\{MAX_LINE_LENGTH\}/g,
    String(defaults.maxLineLength),
  );
  template = template.replace(/\{LINE_ENDINGS\}/g, defaults.lineEndings);
  template = template.replace(/\{FILE_NAMING\}/g, defaults.fileNaming);
  template = template.replace(/\{DIR_NAMING\}/g, defaults.dirNaming);
  template = template.replace(
    /\{TEST_FILE_PATTERN\}/g,
    defaults.testFilePattern,
  );
  template = template.replace(
    /\{FILE_ORGANIZATION_NOTES\}/g,
    defaults.fileOrganizationNotes,
  );
  template = template.replace(
    /\{IMPORT_ORDER_GUIDE\}/g,
    defaults.importOrderGuide,
  );
  template = template.replace(
    /\{FILE_STRUCTURE_NOTES\}/g,
    defaults.fileStructureNotes,
  );
  template = template.replace(/\{VAR_NAMING\}/g, defaults.varNaming);
  template = template.replace(/\{CONST_NAMING\}/g, defaults.constNaming);
  template = template.replace(
    /\{CONST_NAMING_NOTES\}/g,
    defaults.constNamingNotes,
  );
  template = template.replace(/\{FUNC_NAMING\}/g, defaults.funcNaming);
  template = template.replace(/\{TYPE_NAMING\}/g, defaults.typeNaming);
  template = template.replace(
    /\{TYPE_NAMING_NOTES\}/g,
    defaults.typeNamingNotes,
  );
  template = template.replace(/\{CLASS_NAMING\}/g, defaults.classNaming);
  template = template.replace(/\{ENUM_GUIDE\}/g, defaults.enumGuide);
  template = template.replace(
    /\{TYPE_SAFETY_RULES\}/g,
    defaults.typeSafetyRules,
  );
  template = template.replace(
    /\{MAX_PARAMS\}/g,
    String(defaults.maxParams),
  );
  template = template.replace(
    /\{PARAM_DESIGN_NOTES\}/g,
    defaults.paramDesignNotes,
  );
  template = template.replace(/\{RESULT_TYPE\}/g, defaults.resultType);
  template = template.replace(
    /\{CONTROL_FLOW_GUIDE\}/g,
    defaults.controlFlowGuide,
  );
  template = template.replace(/\{ASYNC_GUIDE\}/g, defaults.asyncGuide);
  template = template.replace(
    /\{ERROR_HANDLING_GUIDE\}/g,
    defaults.errorHandlingGuide,
  );
  template = template.replace(/\{LOGGING_GUIDE\}/g, defaults.loggingGuide);
  template = template.replace(/\{COMMENT_GUIDE\}/g, defaults.commentGuide);
  template = template.replace(
    /\{PLACEHOLDER_FORMAT\}/g,
    defaults.placeholderFormat,
  );
  template = template.replace(/\{EXPORT_GUIDE\}/g, defaults.exportGuide);

  template = template.replace(
    /^# .+?\n\n## 用法[\s\S]*?^---\s*\n/gm,
    "",
  );

  return template;
}

// ─── 公开 API ───

export function scanTemplates(projectDir: string): TemplateMeta[] {
  const templateDir = path.join(getDocsDir(projectDir), TEMPLATE_DIR);
  if (!fs.existsSync(templateDir)) return [];

  const entries = fs.readdirSync(templateDir, { withFileTypes: true });
  const templates: TemplateMeta[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const bundleDir = path.join(templateDir, entry.name);
    const flowPath = path.join(bundleDir, "flow.md");
    if (!fs.existsSync(flowPath)) continue;

    const raw = fs.readFileSync(flowPath, "utf-8");
    const meta = parseTemplateMeta(raw, bundleDir);
    if (meta) templates.push(meta);
  }

  return templates;
}

export function installTemplate(
  projectDir: string,
  templateId: string,
): void {
  const templates = scanTemplates(projectDir);
  const meta = templates.find((t) => t.id === templateId);
  if (!meta) {
    throw new Error(`Template "${templateId}" not found.`);
  }

  const docsDir = getDocsDir(projectDir);
  const flowDir = path.join(docsDir, FLOW_DIR);
  const regDir = path.join(docsDir, REGULATION_DIR);

  // 确保目录存在
  fs.mkdirSync(flowDir, { recursive: true });
  fs.mkdirSync(regDir, { recursive: true });

  // 安装 Flow 文档
  const destFlow = path.join(flowDir, `[flow]${meta.id}.md`);
  if (fs.existsSync(destFlow)) {
    throw new TemplateConflictError(`[flow]${meta.id}`);
  }
  fs.copyFileSync(meta.flowPath, destFlow);

  // 安装配套 Regulation（如存在）
  const bundleRegDir = path.join(meta.bundleDir, "regulations");
  if (fs.existsSync(bundleRegDir)) {
    const regFiles = fs
      .readdirSync(bundleRegDir)
      .filter((f) => f.endsWith(".md"));
    for (const regFile of regFiles) {
      const src = path.join(bundleRegDir, regFile);
      const dest = path.join(regDir, regFile);
      if (!fs.existsSync(dest)) {
        fs.copyFileSync(src, dest);
      }
    }
  }

  // 安装 Constitution（如缺失）
  installConstitutionFromTemplate(docsDir, regDir);

  // 安装 Dictionary（如缺失）
  installDictionaryFromTemplate(docsDir, regDir);

  // 安装 Coding Style（如缺失）
  installCodingStyleFromTemplate(projectDir, docsDir, regDir);

  // 写入 DCP 保护配置（如果 DCP 插件已安装）
  writeDcpConfig(projectDir);

  // 生成 Command 文件到 .opencode/commands/
  if (meta.command) {
    const cmdDir = getCommandsDir(projectDir);
    fs.mkdirSync(cmdDir, { recursive: true });

    const cmdFileName = stripLeadingSlash(meta.command) + ".md";
    const cmdPath = path.join(cmdDir, cmdFileName);
    const cmdContent = generateCommandFile(meta);
    fs.writeFileSync(cmdPath, cmdContent, "utf-8");
  }
}

// ─── Regulation 安装 ───

function installRegulationFromTemplate(
  docsDir: string,
  regDir: string,
  templateName: string,
  outputName: string,
): void {
  const dest = path.join(regDir, outputName);
  if (fs.existsSync(dest)) return;

  const templatePath = path.join(docsDir, TEMPLATE_DIR, templateName);
  if (!fs.existsSync(templatePath)) return;

  fs.copyFileSync(templatePath, dest);
}

function installConstitutionFromTemplate(
  docsDir: string,
  regDir: string,
): void {
  installRegulationFromTemplate(
    docsDir,
    regDir,
    CONSTITUTION_TEMPLATE,
    CONSTITUTION_OUTPUT,
  );
}

function installDictionaryFromTemplate(
  docsDir: string,
  regDir: string,
): void {
  installRegulationFromTemplate(
    docsDir,
    regDir,
    DICTIONARY_TEMPLATE,
    DICTIONARY_OUTPUT,
  );
}

function installCodingStyleFromTemplate(
  projectDir: string,
  docsDir: string,
  regDir: string,
): void {
  const dest = path.join(regDir, CODING_STYLE_OUTPUT);
  if (fs.existsSync(dest)) return;

  const languages = detectProjectLanguages(projectDir);
  const content = generateCodingStyle(docsDir, languages);
  if (content) {
    fs.writeFileSync(dest, content, "utf-8");
  }
}

// ─── DCP 配置 ───

function writeDcpConfig(projectDir: string): void {
  const opencodePkg = path.join(projectDir, ".opencode", "package.json");
  if (!fs.existsSync(opencodePkg)) return;

  let hasDcp = false;
  try {
    const pkg = JSON.parse(fs.readFileSync(opencodePkg, "utf-8"));
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    hasDcp = "opencode-dynamic-context-pruning" in deps;
  } catch {
    return;
  }

  if (!hasDcp) return;

  const jsoncPath = path.join(projectDir, ".opencode", "dcp.jsonc");
  const jsonPath = path.join(projectDir, ".opencode", "dcp.json");
  const dcpPath = fs.existsSync(jsoncPath) ? jsoncPath
    : fs.existsSync(jsonPath) ? jsonPath
    : jsoncPath;
  const newProtect = {
    compress: { protectTags: ["pm-constitution", "pm-flow-control"] },
    protectedFilePatterns: ["docs/flow/*", "docs/regulation/*", "docs/spec/*"],
  };

  let existing: Record<string, unknown> = {};
  if (fs.existsSync(dcpPath)) {
    try {
      existing = JSON.parse(fs.readFileSync(dcpPath, "utf-8"));
    } catch {
      // 解析失败则覆盖
    }
  }

  const existingCompress = (existing.compress as Record<string, unknown>) ?? {};
  const existingTags = (existingCompress.protectTags as string[]) ?? [];
  const existingPatterns = (existing.protectedFilePatterns as string[]) ?? [];

  const merged = {
    ...existing,
    compress: {
      ...(existing.compress as Record<string, unknown>),
      protectTags: [...new Set([...existingTags, ...newProtect.compress.protectTags])],
    },
    protectedFilePatterns: [
      ...new Set([...existingPatterns, ...newProtect.protectedFilePatterns]),
    ],
  };

  const dir = path.dirname(dcpPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(dcpPath, JSON.stringify(merged, null, 2), "utf-8");
}

export function uninstallFlow(projectDir: string, flowName: string): void {
  const flowDir = path.join(getDocsDir(projectDir), FLOW_DIR);

  const candidates = [
    path.join(flowDir, `[flow]${flowName}.md`),
    path.join(flowDir, `${flowName}.md`),
  ];

  let removed = false;
  for (const cand of candidates) {
    if (fs.existsSync(cand)) {
      fs.rmSync(cand);
      removed = true;
      break;
    }
  }

  if (!removed) {
    throw new Error(`Flow "${flowName}" not found in /docs/flow/.`);
  }

  // 同时清理对应的 Command 文件
  const cmdDir = getCommandsDir(projectDir);
  if (fs.existsSync(cmdDir)) {
    // 尝试根据 flowName 推断 command 文件名
    const cmdFileName = `pm-${flowName}.md`;
    const cmdPath = path.join(cmdDir, cmdFileName);
    if (fs.existsSync(cmdPath)) {
      fs.rmSync(cmdPath);
    }
    // 也尝试不带 pm- 前缀的文件名
    const altCmdPath = path.join(cmdDir, `${flowName}.md`);
    if (fs.existsSync(altCmdPath)) {
      fs.rmSync(altCmdPath);
    }
  }
}

export function listInstalledFlows(projectDir: string): string[] {
  const flowDir = path.join(getDocsDir(projectDir), FLOW_DIR);
  if (!fs.existsSync(flowDir)) return [];

  return fs
    .readdirSync(flowDir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.replace(/^\[flow\][_]?/, "").replace(/\.md$/, ""));
}

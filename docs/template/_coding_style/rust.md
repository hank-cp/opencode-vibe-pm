# Rust 编码风格

## 通用格式

- 统一使用 UTF-8 编码，换行符使用 LF
- 使用 rustfmt 自动格式化代码（保存时自动执行）
- 缩进使用 4 空格，不使用 Tab
- 行长度建议不超过 100 字符
- 文件末尾保留一个空行

## 文件组织

### 命名

- 源文件使用 `snake_case`
- 目录名使用 `snake_case`
- 测试文件命名：`#[cfg(test)]` 模块内联或 `tests/` 目录

### Import 分组

```rust
// 1. 标准库
use std::collections::HashMap;
use std::path::PathBuf;

// 2. 第三方 crate
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

// 3. 项目内部模块
use crate::core::config::Config;
use crate::models::user::User;
```

### 文件结构

- 每个文件尽量只有一个主要导出
- 辅助类型/函数使用命名导出
- 模块暴露出清晰的公共 API

## 命名规范

### 变量

- 使用 `snake_case`
- 短作用域用短名字：`i`, `item`, `ctx`
- 长作用域用描述性名字：`task_config`, `message_count`

### 常量

- `UPPER_SNAKE_CASE`
- 静态变量使用 `SCREAMING_SNAKE_CASE`

### 函数

- 使用 `snake_case`
- 动词开头：`get_task`, `find_flow`, `create_plan`, `parse_spec`

### 类型

- 使用 `PascalCase`
- trait 名使用 PascalCase，避免 `-able` 后缀
- Rust 没有类，struct/enum 使用 `PascalCase`

### 枚举

使用 `enum` + `#[derive(...)]`：

```rust
#[derive(Debug, Clone, PartialEq)]
enum TaskStatus {
    Running,
    Completed,
    Closed,
}
```

## 类型安全

### 规则

- ✅ 利用 Rust 的所有权和借用系统，避免不必要的 `.clone()`
- ✅ 使用 `Result<T, E>` 和 `Option<T>` 代替 null
- ✅ 使用 `clippy` 进行 lint 检查
- ❌ 禁止使用 `unsafe`（除非有充分理由并注释说明）
- ❌ 禁止 `unwrap()` 和 `expect()` 在生产路径中

## 函数设计

### 参数

- 超过 3 个参数使用结构体参数
- 使用 builder 模式处理复杂构造

### 返回值

- `Result<T, E>` 和 `Option<T>`

## 控制流

- 使用 `match` 进行模式匹配
- 使用 `if let` 简化单分支匹配
- 使用 `?` 运算符传播错误

## 异步处理

- 使用 `tokio` 运行时
- 异步函数返回 `impl Future<Output = T>` 或标注 `async fn`

```rust
async fn load_task(session_id: &str) -> Result<Option<Task>, DbError> {
    let data = db.query("SELECT * FROM tasks WHERE session_id = ?", session_id).await?;
    Ok(data.map(Task::from_row))
}
```

## 错误处理

- 使用 `thiserror` 定义错误类型
- 使用 `?` 运算符传播错误
- 使用 `anyhow` 处理应用级错误

```rust
use thiserror::Error;

#[derive(Error, Debug)]
enum AppError {
    #[error("failed to load task: {0}")]
    DbError(#[from] DbError),
}
```

## 日志

- 使用 `tracing` / `log` crate
- 日志消息使用英文

```rust
tracing::info!(session_id = %session_id, "task created");
tracing::error!(error = %e, "failed to load task");
```

## 注释与文档

- 代码注释使用英文
- 公共 API 使用 `///` 文档注释
- 模块使用 `//!` 注释

## 占位代码

```rust
// TODO(username): 需要对接 API — 预计 v1.1
// FIXME(username): 并发场景下可能数据竞争 — 需要加锁
// HACK(username): 临时绕过限制 — v1.0 后替换
```

## 导出规范

- 使用 `pub` 控制可见性
- `pub(crate)` 限制 crate 内可见
- 模块通过 `mod.rs` 或同名文件组织

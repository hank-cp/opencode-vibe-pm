# Rust Coding Style

## General Format

- Use UTF-8 encoding consistently, LF for line endings
- Use rustfmt for automatic code formatting (runs on save)
- Use 4 spaces for indentation, no tabs
- Line length recommended not to exceed 100 characters
- Keep one blank line at the end of files

## File Organization

### Naming

- Source files use `snake_case`
- Directory names use `snake_case`
- Test file naming: inline `#[cfg(test)]` modules or `tests/` directory

### Import Grouping

```rust
// 1. Standard library
use std::collections::HashMap;
use std::path::PathBuf;

// 2. Third-party crates
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

// 3. Project internal modules
use crate::core::config::Config;
use crate::models::user::User;
```

### File Structure

- Prefer one primary export per file
- Use named exports for auxiliary types/functions
- Expose a clear public API from modules

## Naming Conventions

### Variables

- Use `snake_case`
- Short names for short scopes: `i`, `item`, `ctx`
- Descriptive names for longer scopes: `task_config`, `message_count`

### Constants

- `UPPER_SNAKE_CASE`
- Static variables use `SCREAMING_SNAKE_CASE`

### Functions

- Use `snake_case`
- Start with a verb: `get_task`, `find_flow`, `create_plan`, `parse_spec`

### Types

- Use `PascalCase`
- Trait names use PascalCase, avoid `-able` suffix
- Rust has no classes; struct/enum use `PascalCase`

### Enums

Use `enum` with `#[derive(...)]`:

```rust
#[derive(Debug, Clone, PartialEq)]
enum TaskStatus {
    Running,
    Completed,
    Closed,
}
```

## Type Safety

### Rules

- ✅ Leverage Rust's ownership and borrowing system; avoid unnecessary `.clone()`
- ✅ Use `Result<T, E>` and `Option<T>` instead of null
- ✅ Use `clippy` for lint checks
- ❌ Do not use `unsafe` (unless with a strong justification and comments)
- ❌ Do not use `unwrap()` or `expect()` in production paths

## Function Design

### Parameters

- Use struct parameters when exceeding 3 parameters
- Use the builder pattern for complex construction

### Return Values

- `Result<T, E>` and `Option<T>`

## Control Flow

- Use `match` for pattern matching
- Use `if let` to simplify single-branch matches
- Use the `?` operator to propagate errors

## Async Handling

- Use the `tokio` runtime
- Async functions return `impl Future<Output = T>` or are annotated with `async fn`

```rust
async fn load_task(session_id: &str) -> Result<Option<Task>, DbError> {
    let data = db.query("SELECT * FROM tasks WHERE session_id = ?", session_id).await?;
    Ok(data.map(Task::from_row))
}
```

## Error Handling

- Use `thiserror` to define error types
- Use the `?` operator to propagate errors
- Use `anyhow` for application-level errors

```rust
use thiserror::Error;

#[derive(Error, Debug)]
enum AppError {
    #[error("failed to load task: {0}")]
    DbError(#[from] DbError),
}
```

## Logging

- Use the `tracing` / `log` crate
- Log messages in English

```rust
tracing::info!(session_id = %session_id, "task created");
tracing::error!(error = %e, "failed to load task");
```

## Comments & Documentation

- Code comments in English
- Use `///` doc comments for public API
- Use `//!` comments for modules

## Placeholder Code

```rust
// TODO(username): Needs API integration — planned for v1.1
// FIXME(username): Possible data race in concurrent scenarios — needs locking
// HACK(username): Temporary workaround — replace after v1.0
```

## Export Conventions

- Use `pub` to control visibility
- `pub(crate)` restricts visibility to within the crate
- Organize modules via `mod.rs` or same-name files

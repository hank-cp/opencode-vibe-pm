# Python 编码风格

## 通用格式

- 统一使用 UTF-8 编码，换行符使用 LF
- 使用 Black + isort 自动格式化代码（保存时自动执行）
- 缩进使用 4 空格，不使用 Tab
- 行长度建议不超过 88 字符
- 文件末尾保留一个空行

## 文件组织

### 命名

- 源文件使用 `snake_case`
- 目录名使用 `snake_case`
- 测试文件命名：`test_*.py` 或 `*_test.py`

### Import 分组

```python
# 1. 标准库
import os
from pathlib import Path

# 2. 第三方库
import requests
from pydantic import BaseModel

# 3. 项目内部模块
from app.core.config import settings
from app.models.user import User
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
- 布尔变量用疑问词前缀：`is_active`, `has_plan`, `can_proceed`
- 不使用匈牙利命名法

### 常量

- `UPPER_SNAKE_CASE`

```python
DEFAULT_LANGUAGE = "zh-CN"
MAX_RETRY_COUNT = 3
```

### 函数

- 使用 `snake_case`
- 动词开头：`get_task`, `find_flow`, `create_plan`, `parse_spec`
- 事件处理函数：`handle_xxx` 或 `on_xxx`

### 类型与类

- 使用 `PascalCase`
- 遵循 PEP 8，类名使用 CapWords

```python
class TaskState:
    session_id: str
    flow: str
    current_step: str
```

### 枚举

使用 `Enum`，成员使用 `UPPER_SNAKE_CASE`

```python
from enum import Enum

class TaskStatus(Enum):
    RUNNING = "running"
    COMPLETED = "completed"
    CLOSED = "closed"
```

## 类型安全

### 推荐方式

```python
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
```

### 禁止事项

- ❌ 禁止裸 except（至少捕获 Exception）
- ❌ 禁止在生产代码中使用 print() 代替日志
- ❌ 禁止可变默认参数

## 函数设计

### 参数

- 超过 3 个参数使用对象/结构体参数

### 返回值

- 优先返回具体类型，避免 None
- 可能返回"空"的场景使用 `Result` 模式（如 returns 库）或 `Optional[T]`

## 异步处理

- 使用 `async/await`（asyncio）
- 异步函数使用 `async def`
- 避免混用同步/异步代码

```python
async def load_task(session_id: str) -> Task | None:
    data = await db.fetch_one("SELECT * FROM tasks WHERE session_id = ?", session_id)
    return Task.from_row(data) if data else None
```

## 错误处理

- 明确捕获异常类型，不使用裸 `except:`
- 在系统边界进行输入校验
- 使用自定义异常类

```python
try:
    result = await risky_operation()
except ConnectionError as e:
    logger.error("Operation failed", extra={"error": str(e)})
    raise OperationError("Failed to complete operation") from e
```

## 日志

- 使用 `logging` 模块，不直接用 `print()`
- 日志消息使用英文
- 关键路径记录 info/debug 日志

```python
import logging

logger = logging.getLogger(__name__)
logger.info("Task created", extra={"session_id": session_id})
logger.error("Failed to load task", extra={"error": str(e)})
```

## 注释与文档

- 代码注释使用英文
- 公共 API 使用 docstring（Google 或 NumPy 风格）
- 复杂逻辑添加解释性注释

## 占位代码

```python
# TODO(username): 需要对接 API — 预计 v1.1
# FIXME(username): 并发场景下可能数据竞争 — 需要加锁
# HACK(username): 临时绕过限制 — v1.0 后替换
```

## 导出规范

```python
# __init__.py 中控制导出
__all__ = ["FlowParser", "parse_flow", "FlowDefinition"]

# 主要导出
class FlowParser: ...

# 辅助函数使用命名导出
def parse_flow(path: str) -> FlowDefinition: ...
```

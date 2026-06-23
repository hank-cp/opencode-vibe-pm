# Go 编码风格

## 通用格式

- 统一使用 UTF-8 编码，换行符使用 LF
- 使用 gofmt / goimports 自动格式化代码（保存时自动执行）
- 缩进使用 Tab
- 行长度建议不超过 120 字符
- 文件末尾保留一个空行

## 文件组织

### 命名

- 源文件使用 `snake_case`（小写 + 下划线）
- 目录名使用 `snake_case`（小写，简短）
- 测试文件命名：`*_test.go`，与被测文件同目录
- 包名使用简短小写单词，避免下划线

### Import 分组

```go
import (
    // 1. 标准库
    "fmt"
    "os"

    // 2. 第三方库
    "github.com/gin-gonic/gin"

    // 3. 项目内部包
    "example.com/project/internal/models"
)
```

### 文件结构

- 一个目录一个包，包名与目录名一致
- 每个文件尽量只有一个主要导出
- 辅助类型/函数使用命名导出

## 命名规范

### 变量

- 使用 `camelCase`（导出：`PascalCase`）
- 短作用域用短名字：`i`, `item`, `ctx`
- 长作用域用描述性名字：`taskConfig`, `messageCount`
- 布尔变量用疑问词前缀：`isActive`, `hasPlan`, `canProceed`

### 常量

- `PascalCase` 或 `camelCase`（导出：`PascalCase`）
- Go 不使用 UPPER_SNAKE_CASE

### 函数

- 使用 `camelCase`（导出：`PascalCase`）
- 动词开头：`getTask`, `findFlow`, `createPlan`, `parseSpec`

### 类型与结构体

- 使用 `PascalCase`
- 接口名通常以 `-er` 结尾（如 `Reader`, `Writer`）
- Go 没有类，使用 `PascalCase` 命名 struct

### 枚举

Go 没有原生枚举，使用 `const` + `iota`：

```go
type TaskStatus int

const (
    TaskStatusRunning TaskStatus = iota
    TaskStatusCompleted
    TaskStatusClosed
)
```

## 类型安全

### 规则

- ✅ 使用强类型，避免 `interface{}`（优先使用泛型或具体类型）
- ✅ 显式错误处理：每个可能失败的调用都检查 `if err != nil`
- ✅ 使用 `go vet` 和 `staticcheck` 进行静态分析
- ❌ 禁止忽略错误返回值

## 函数设计

### 参数

- 超过 3 个参数使用结构体参数

### 返回值

- `(T, error)` 元组

## 控制流

- 优先使用提前返回（early return），减少嵌套
- `switch` 不需要 `break`，使用 `fallthrough` 明确穿透

## 异步处理

- 使用 goroutine + channel 进行并发
- 使用 `context.Context` 传递取消信号和超时
- 使用 `sync.WaitGroup` / `errgroup` 管理并发

```go
func LoadTask(ctx context.Context, sessionID string) (*Task, error) {
    // ...
}
```

## 错误处理

- 每个可能失败的调用都显式处理错误
- 错误信息使用小写开头，不以标点结尾
- 使用 `fmt.Errorf` 包装错误

```go
data, err := db.Query("SELECT * FROM tasks WHERE session_id = ?", sessionID)
if err != nil {
    return nil, fmt.Errorf("failed to load task: %w", err)
}
```

## 日志

- 使用结构化日志库（如 `slog`、`zap`）
- 日志消息使用英文

```go
slog.Info("task created", "sessionID", sessionID)
slog.Error("failed to load task", "error", err)
```

## 注释与文档

- 代码注释使用英文
- 导出的类型/函数必须有文档注释（以名称开头）
- 复杂逻辑添加解释性注释

## 占位代码

```go
// TODO(username): 需要对接 API — 预计 v1.1
// FIXME(username): 并发场景下可能数据竞争 — 需要加锁
// HACK(username): 临时绕过限制 — v1.0 后替换
```

## 导出规范

- 大写首字母 = 导出（public）
- 小写首字母 = 包内私有（private）
- 避免导出不必要的符号

# Java 编码风格

## 通用格式

- 统一使用 UTF-8 编码，换行符使用 LF
- 使用 Spotless / google-java-format 自动格式化代码
- 缩进使用 4 空格，不使用 Tab
- 行长度建议不超过 120 字符
- 文件末尾保留一个空行

## 文件组织

### 命名

- 源文件使用 `PascalCase`（一个文件一个公共类）
- 目录名使用 `snake_case` 或按包名约定
- 测试文件命名：`*Test.java`，在 `src/test/` 下镜像 `src/main/` 结构
- 包名全小写，使用反向域名（如 `com.example.project`）

### Import 分组

```java
// 1. 静态导入
import static org.junit.Assert.*;

// 2. Java 标准库
import java.util.List;
import java.util.Optional;

// 3. 第三方库
import com.google.common.collect.ImmutableList;

// 4. 项目内部
import com.example.project.core.TaskState;
```

### 文件结构

- 每个文件一个顶层类，类名与文件名一致
- 每个文件尽量只有一个主要导出
- 辅助类型/函数使用命名导出

## 命名规范

### 变量

- 使用 `camelCase`
- 短作用域用短名字：`i`, `item`, `ctx`
- 长作用域用描述性名字：`taskConfig`, `messageCount`
- 布尔变量用疑问词前缀：`isActive`, `hasPlan`, `canProceed`

### 常量

- `UPPER_SNAKE_CASE`（`static final` 字段）

### 函数

- 使用 `camelCase`
- 动词开头：`getTask`, `findFlow`, `createPlan`, `parseSpec`

### 类型与接口

- 使用 `PascalCase`
- 接口名不加 `I` 前缀

### 枚举

使用 `enum`，成员使用 `UPPER_SNAKE_CASE`：

```java
public enum TaskStatus {
    RUNNING,
    COMPLETED,
    CLOSED
}
```

## 类型安全

### 规则

- ✅ 使用泛型避免原始类型
- ✅ 使用 `Optional<T>` 代替 null 返回
- ✅ 使用 `final` 修饰不可变字段
- ❌ 禁止捕获 `Exception` 后吞掉

## 函数设计

### 参数

- 超过 3 个参数使用 Builder 模式处理复杂构造

### 返回值

- `Optional<T>` 或自定义 `Result<T, E>`

## 异步处理

- 使用 `CompletableFuture<T>` 或响应式框架
- 异步方法返回 `Future<T>`

```java
public CompletableFuture<Optional<Task>> loadTask(String sessionId) {
    return db.queryAsync("SELECT * FROM tasks WHERE session_id = ?", sessionId)
        .thenApply(data -> data != null ? Task.fromRow(data) : null);
}
```

## 错误处理

- 捕获具体异常类型
- 使用自定义异常类
- 在 finally 中释放资源（或使用 try-with-resources）

```java
try {
    var result = riskyOperation();
} catch (IOException e) {
    logger.error("Operation failed", e);
    throw new OperationException("Failed to complete operation", e);
}
```

## 日志

- 使用 SLF4J + Logback
- 日志消息使用英文

```java
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

private static final Logger logger = LoggerFactory.getLogger(TaskService.class);
logger.info("Task created, sessionId={}", sessionId);
logger.error("Failed to load task", e);
```

## 注释与文档

- 代码注释使用英文
- 公共 API 使用 Javadoc
- 复杂逻辑添加解释性注释

## 占位代码

```java
// TODO(username): 需要对接 API — 预计 v1.1
// FIXME(username): 并发场景下可能数据竞争 — 需要加锁
// HACK(username): 临时绕过限制 — v1.0 后替换
```

## 导出规范

使用 `public` / `protected` / package-private 控制可见性

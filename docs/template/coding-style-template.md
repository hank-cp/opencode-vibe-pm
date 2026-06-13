# 编码风格模板

## 用法

此模板在 `/pm-install-flow` 执行时自动处理：根据项目使用的语言生成对应的 `docs/regulation/coding_style.md`。

手动创建时，复制此文件到 `docs/regulation/coding_style.md`，将 `{PLACEHOLDER}` 替换为对应语言的具体规则。

> **Flow 步骤引用**：在 Flow 文档中涉及编写代码的步骤，通过 `**引用 Regulation**: coding_style.md` 引用。
> 此模板中的占位符 `{PLACEHOLDER}` 会在安装时自动替换为语言对应的默认值。

---

# {LANGUAGE} 编码风格

## 通用格式

- 统一使用 UTF-8 编码，换行符使用 LF
- 使用 {FORMATTER} 自动格式化代码（保存时自动执行）
- 缩进使用 {INDENT}
- 行长度建议不超过 {MAX_LINE_LENGTH} 字符
- 文件末尾保留一个空行
- {LINE_ENDINGS}

## 文件组织

### 命名

- 源文件使用 {FILE_NAMING}
- 目录名使用 {DIR_NAMING}
- 测试文件命名：{TEST_FILE_PATTERN}
- {FILE_ORGANIZATION_NOTES}

### Import / 依赖引入

{IMPORT_ORDER_GUIDE}

### 文件结构

- 每个文件尽量只有一个主要导出
- 辅助类型/函数使用命名导出
- 模块暴露出清晰的公共 API
- {FILE_STRUCTURE_NOTES}

## 命名规范

### 变量

- 使用 {VAR_NAMING}
- 短作用域用短名字：`i`, `item`, `ctx`
- 长作用域用描述性名字：`taskConfig`, `messageCount`
- 布尔变量用疑问词前缀：`isActive`, `hasPlan`, `canProceed`
- 不使用匈牙利命名法

### 常量

- {CONST_NAMING}
- {CONST_NAMING_NOTES}

### 函数

- 使用 {FUNC_NAMING}
- 动词开头：`getTask`, `findFlow`, `createPlan`, `parseSpec`
- 事件处理函数：`handleXxx` 或 `onXxx`

### 类型 / 接口 / 类

- 类型与接口使用 {TYPE_NAMING}
- {TYPE_NAMING_NOTES}
- 类使用 {CLASS_NAMING}
- 公共方法在前，私有方法在后

### 枚举 / 联合类型

{ENUM_GUIDE}

## 类型安全

{TYPE_SAFETY_RULES}

## 函数设计

### 参数

- 超过 {MAX_PARAMS} 个参数使用对象/结构体参数
- {PARAM_DESIGN_NOTES}

### 返回值

- 优先返回具体类型，避免 null/undefined
- 可能返回"空"的场景使用 {RESULT_TYPE}

## 控制流

{CONTROL_FLOW_GUIDE}

## 异步处理

{ASYNC_GUIDE}

## 错误处理

{ERROR_HANDLING_GUIDE}

## 日志

{LOGGING_GUIDE}

## 注释与文档

{COMMENT_GUIDE}

## 占位代码

- 标记格式：{PLACEHOLDER_FORMAT}

## 导出/可见性

{EXPORT_GUIDE}

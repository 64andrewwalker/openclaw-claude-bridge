# Agent Experience Optimization — PRD & Design

## 1. 背景

CodeBridge 已具备完整的任务执行能力（Claude Code + Kimi Code 引擎），但从 AI agent（特别是 Claude Code）的视角调用体验很差：

- `result.json` 缺少关键信息（变更了哪些文件）
- 错误信息只有 code，没有可执行的修复建议
- 没有 Claude Code skill 包装，agent 不知道怎么调用、怎么解读结果
- CLI 未全局安装，不能直接在终端使用

## 2. 目标

让 Claude Code 能自然地将复杂编码任务委托给 codebridge，并获得足够的结构化反馈来继续工作。

**不做的事：**
- 不做实时流式反馈（agent 不需要心跳，人类才需要）
- 不做 MCP server（V2 范围）
- 不做 npm publish（本地 npm link 足够）

## 3. 设计

### 3.1 CLI 输出增强

在 `result.json` 中新增 `files_changed` 字段：

```json
{
  "run_id": "run-xyz",
  "status": "completed",
  "summary": "实现了用户认证模块...",
  "session_id": "session-abc",
  "artifacts": [],
  "duration_ms": 15234,
  "token_usage": { "prompt_tokens": 1234, "completion_tokens": 567, "total_tokens": 1801 },
  "files_changed": ["src/auth.ts", "src/middleware.ts", "tests/auth.test.ts"]
}
```

**提取方式：** 引擎执行完毕后，在 workspace 中执行：
- `git diff --name-only HEAD` — 已修改文件
- `git ls-files --others --exclude-standard` — 新增未跟踪文件
- 合并去重后写入 `files_changed`
- 非 git 仓库返回 `null`

**失败结果增加 `suggestion` 字段：**

```json
{
  "status": "failed",
  "error": {
    "code": "ENGINE_TIMEOUT",
    "message": "Process killed after 30000ms",
    "retryable": true,
    "suggestion": "增大 --timeout 或拆分任务为更小的步骤"
  }
}
```

静态映射表：

| error code | suggestion |
|---|---|
| `ENGINE_TIMEOUT` | 增大 --timeout 或拆分任务为更小的步骤 |
| `ENGINE_CRASH` | 引擎进程崩溃，可直接重试 |
| `ENGINE_AUTH` | 检查引擎的认证凭据是否有效 |
| `WORKSPACE_NOT_FOUND` | 指定的工作目录不存在，确认路径 |
| `WORKSPACE_INVALID` | 工作目录在安全白名单之外 |
| `REQUEST_INVALID` | 请求参数校验失败，检查 intent/engine/workspace 字段 |
| `RUNNER_CRASH_RECOVERY` | 守护进程崩溃恢复，可直接重试 |
| `TASK_STOPPED` | 任务被主动停止，不要自动重试 |

### 3.2 Schema 变更

**`src/schemas/result.ts`** — 新增 `files_changed`:
```typescript
files_changed: z.array(z.string()).nullable().default(null)
```

**`src/schemas/errors.ts`** — `makeError()` 自动附带 `suggestion`:
```typescript
export function makeError(code: ErrorCode, message: string): TaskError {
  return { code, message, retryable: RETRYABLE[code], suggestion: SUGGESTIONS[code] };
}
```

### 3.3 Runner 变更

**`src/core/runner.ts`** — 引擎执行后、写 result 前，调用 `getFilesChanged(workspacePath)`:

```typescript
function getFilesChanged(cwd: string): string[] | null {
  try {
    const modified = execSync('git diff --name-only HEAD', { cwd, encoding: 'utf-8' }).trim();
    const untracked = execSync('git ls-files --others --exclude-standard', { cwd, encoding: 'utf-8' }).trim();
    const all = [...modified.split('\n'), ...untracked.split('\n')].filter(Boolean);
    return [...new Set(all)];
  } catch {
    return null; // 不是 git 仓库
  }
}
```

### 3.4 Skill 重写

重写 `skill/codebridge/SKILL.md`，给 Claude Code 明确的使用指南：

**核心内容：**
- 什么时候用（委托复杂多文件编码任务）
- 怎么调用（codebridge submit --wait 的完整参数）
- 怎么解读结果（status/summary/files_changed/error）
- 错误处理流程（retryable → 重试 / 不可重试 → 报告 suggestion）
- 限制（不要跑超长任务用 --wait，session resume 的条件）

### 3.5 安装

```bash
cd /Volumes/DevWork/infra/openclaw-claude-bridge
npm run build && npm link
```

## 4. 影响范围

| 文件 | 变更类型 |
|---|---|
| `src/schemas/result.ts` | 新增 `files_changed` 字段 |
| `src/schemas/errors.ts` | 新增 `suggestion` 字段 + 映射表 |
| `src/core/runner.ts` | 新增 `getFilesChanged()` + 结果写入 |
| `skill/codebridge/SKILL.md` | 重写 |
| 测试文件 | 新增/更新对应测试 |

## 5. 不做的事

- 不加流式输出（agent 等结果就行）
- 不加心跳/进度条（那是给人看的）
- 不散落配置文件（skill 在仓库内，CLI 通过 npm link）
- 不做 MCP adapter（V2）
- 不重构现有 CLI 命令结构

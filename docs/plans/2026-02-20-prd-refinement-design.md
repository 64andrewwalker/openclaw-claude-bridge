# CodeBridge PRD Refinement Design

> Brainstorming session output — validated decisions and PRD improvement plan.

## Context

Original PRD (`docs/PRD.md`) describes an OpenClaw-Claude bridge. Through brainstorming we identified 6 areas needing correction or expansion. This document captures the validated decisions and serves as the blueprint for updating the PRD.

## Key Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | **Rename project to `codebridge`** | 不绑定 Claude 品牌，未来接 Codex/OpenCode |
| 2 | **CLI-first, V1 不做 MCP** | MCP 上下文冗余，CLI 是模型最擅长调用的方式 |
| 3 | **混合模式 runner**（常驻进程 + 文件驱动） | 兼顾可观测性和解耦 |
| 4 | **同机部署** | V1 最简，本地文件 + unix socket 通信 |
| 5 | **TypeScript/Node.js** | MCP SDK 原生 TS，生态一致 |
| 6 | **V1 只做 Claude Code，预留多引擎接口** | 快速交付，架构不锁死 |
| 7 | **一个任务 = 一个 Claude Code 会话** | 保持完整上下文，通过 `--resume` 续接 |
| 8 | **Bridge 自动管理会话生命周期** | 同任务追加指令自动 resume，新任务开新会话 |
| 9 | **意图识别由 OpenClaw agent 完成**，Skill 只负责"被选中后怎么用" | 渐进式披露，节约 context |

## Improvement 1: Core Architecture Repositioning

### Problem

PRD 中 MCP Adapter 方向反了。写的是"给 Claude Code 注入 OpenClaw 工具"，实际应该是"把编码引擎能力暴露给 OpenClaw 用"。且 V1 应以 CLI 而非 MCP 作为通信方式。

### Changes

**§1 背景与目标**：
- 项目名改为 `codebridge`
- 定位改为："把 Claude Code CLI（及未来 Codex/OpenCode）封装为 OpenClaw 可调用的编码引擎，通过 CLI + 文件驱动协议交互"

**§6.1 架构组件**（重写）：
- `openclaw-skill` → `codebridge-skill`：OpenClaw 入口 Skill，指导 agent 如何调用 codebridge CLI
- `codebridge-cli`：CLI 入口，子命令包括 submit / status / resume / logs / doctor
- `bridge-runner`：常驻进程，监控 `.runs/` 目录，编排任务执行
- `session-manager`：会话生命周期管理（创建、续接、结束）
- `engine-adapter`：编码引擎抽象层（V1: claude-code）
- `result-publisher`：结果标准化（JSON stdout + 文件产物）

**移除**：`mcp-openclaw-toolkit` → 移入 Out of Scope (V2)

**§6.3 控制流**（重写）：
1. OpenClaw agent 判断需要编码引擎，触发 `codebridge` Skill
2. Skill 指导 agent 构造 CLI 调用：`codebridge submit --intent coding --workspace /path --message "..."`
3. CLI 将请求写入 `.runs/<run_id>/request.json`
4. bridge-runner 检测到新请求，启动 Claude Code 会话
5. Claude Code 在工作目录中执行任务
6. bridge-runner 收敛结果，写入 `result.json`
7. CLI 返回结构化 JSON 到 stdout，OpenClaw 捕获并渲染

**追加指令流**：
1. 用户追问 → agent 调用 `codebridge resume <run_id> --message "..."`
2. bridge-runner 通过 `claude --resume <session_id>` 续接会话
3. 结果追加到同一 run 目录

## Improvement 2: Session Lifecycle Management

### New Section: §6.4 会话生命周期

**核心原则**：一个任务 = 一个 Claude Code 会话，会话内保持完整上下文。

**会话状态机**：
```
created → running → paused → completed
                  ↘ failed
```

**文件落盘**：
- `.runs/<run_id>/session.json` — 会话元数据
  - `engine`: "claude-code"
  - `session_id`: Claude Code 会话 ID
  - `state`: created | running | paused | completed | failed
  - `created_at`, `last_active_at`

**会话创建**：新任务自动启动新 Claude Code 会话。

**会话续接**：同一任务的追加指令通过 `claude --resume <session_id>` 继续。

**会话结束条件**：
- 任务完成（Claude Code 返回成功）
- 用户显式关闭（`codebridge stop <run_id>`）
- 超时（configurable, default 30 min）
- 不可恢复错误

**Bridge 重启恢复**：会话元数据全部落盘，bridge 重启后可恢复对进行中会话的跟踪。

## Improvement 3: Multi-Engine Abstraction

### New Section: §6.5 多引擎抽象层

**Engine 接口**（TypeScript）：
```typescript
interface Engine {
  start(task: TaskRequest): Promise<SessionInfo>
  send(sessionId: string, message: string): Promise<EngineResponse>
  status(sessionId: string): Promise<SessionState>
  stop(sessionId: string): Promise<void>
}
```

**V1 实现**：`engines/claude-code.ts`
- 翻译为 `claude --print` / `claude --resume` CLI 调用
- 解析 Claude Code 的 stdout/stderr
- 管理 Claude Code 会话 ID

**V2 预留**：
- `engines/codex.ts`
- `engines/opencode.ts`

**目录结构**：
```
src/
  core/
    engine.ts          # Engine interface
    session-manager.ts # 会话生命周期
    runner.ts          # 任务编排
  engines/
    claude-code.ts     # V1
```

## Improvement 4: OpenClaw Skill Specification

### New Section: §6.6 OpenClaw Skill 规范

**Skill 文件**：`skill/codebridge/SKILL.md`

```yaml
---
name: codebridge
description: Delegate complex coding, refactoring, debugging, and ops tasks to a powerful coding engine via CLI.
---
```

**渐进式披露**：
- `description` 始终在 agent context 中 → agent 据此判断是否触发
- Skill 内容（SKILL.md body）仅在触发后加载 → 节约 context

**Skill 内容职责**（被触发后）：
1. 指导 agent 构造正确的 CLI 调用（submit / resume / status）
2. 定义参数映射规则（用户意图 → --intent / --workspace / --message）
3. 指导 agent 解析返回 JSON 并渲染为用户友好消息
4. 定义何时 resume 已有会话 vs 开新会话的判断逻辑
5. 错误处理策略（retryable → 自动重试，non-retryable → 提示用户）

## Improvement 5: File Protocol Enhancement

### Changes to §6.2

**`request.json` 新增字段**：
- `engine`: string — 引擎标识（V1 固定 "claude-code"）
- `session_id`: string | null — 续接时填入，新任务为 null
- `mode`: "new" | "resume"

**`result.json` 新增字段**：
- `session_id`: string — 此次执行的会话 ID（用于后续 resume）
- `duration_ms`: number
- `token_usage`: object | null（如果引擎提供）

**新增文件**：
- `.runs/<run_id>/session.json` — 会话元数据

**完整 run 目录结构**：
```
.runs/<run_id>/
  request.json      # 任务请求
  session.json      # 会话元数据
  context/          # 输入上下文文件
  logs/             # 执行日志
  artifacts/        # 产物（patch、脚本、生成代码）
  result.json       # 执行结果
```

## Improvement 6: Milestones & Repository Structure

### §10 里程碑（修正）

**M1（Week 1）**：
- 初始化 codebridge 仓库（TS 项目骨架）
- 定义 Engine 接口 + request/result/session JSON Schema
- Claude Code engine adapter MVP（本地 JSON → Claude Code CLI → result.json）

**M2（Week 2）**：
- `codebridge` CLI 子命令（submit / status / resume / logs / doctor）
- OpenClaw `codebridge` Skill 打通端到端

**M3（Week 3）**：
- bridge-runner 常驻进程 + 心跳
- 错误分类和自动重试
- 会话生命周期完整实现

**M4（Week 4）**：
- 文档、示例、回归测试
- 小规模生产验证

### §12 仓库结构（修正）

```
codebridge/
  docs/
    PRD.md
  specs/
    request.schema.json
    result.schema.json
    session.schema.json
  src/
    cli/              # CLI 入口与子命令
      index.ts
      commands/
        submit.ts
        status.ts
        resume.ts
        logs.ts
        doctor.ts
    core/
      engine.ts       # Engine interface
      runner.ts       # 任务编排
      session-manager.ts
    engines/
      claude-code.ts  # V1: Claude Code CLI adapter
    utils/
      logger.ts
      errors.ts
  skill/
    codebridge/
      SKILL.md
  tests/
  package.json
  tsconfig.json
```

### §5 Out of Scope 新增

- MCP 封装（V2 — 上下文冗余，CLI 优先）
- 多引擎实现（V2 — V1 只做 Claude Code，接口已预留）
- 跨机器部署（V2 — V1 同机部署）

## Summary of All PRD Changes

| Section | Action | Key Change |
|---------|--------|------------|
| §1 背景与目标 | 修改 | 项目改名 codebridge，定位改为 CLI-first |
| §5 产品范围 | 修改 | Out of Scope 加入 MCP、多引擎实现、跨机部署 |
| §6.1 架构组件 | 重写 | 去 MCP，改 CLI + runner + engine adapter |
| §6.2 文件协议 | 扩展 | 新增 engine/session_id/mode/duration 字段 |
| §6.3 控制流 | 重写 | 反映 CLI 调用链和 resume 流 |
| §6.4 会话管理 | **新增** | 会话生命周期、状态机、落盘恢复 |
| §6.5 多引擎抽象 | **新增** | Engine 接口、V1 只实现 claude-code |
| §6.6 Skill 规范 | **新增** | 渐进式披露、Skill 职责定义 |
| §10 里程碑 | 修正 | 反映 CLI-first 和会话管理 |
| §12 仓库结构 | 修正 | TS 项目结构，src/ 分层 |

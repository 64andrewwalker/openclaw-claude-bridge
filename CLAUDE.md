# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CodeBridge is a file-driven task execution bridge that lets OpenClaw delegate complex coding tasks to AI coding agents (Claude Code, Kimi Code). It uses the filesystem as its message bus — each task is a directory under `.runs/` containing `request.json`, `session.json`, and `result.json`.

## Commands

```bash
npm run build        # TypeScript compile to dist/, marks CLI executable
npm test             # Vitest full suite (single run)
npm run test:watch   # Vitest in watch mode
npm run dev          # Run CLI with tsx

# Single test file
npx vitest run tests/core/runner.test.ts

# Single test by name
npx vitest run -t "executes a task end-to-end"
```

No linter is configured. TypeScript `strict: true` is the only static analysis.

## Architecture

### File-Driven Task Protocol

Every task is a run directory under `.runs/<run_id>/`:
- `request.json` — written by CLI, consumed atomically by runner (renamed to `request.processing.json`)
- `session.json` — mutable state machine: `created → running → completed|failed`
- `result.json` — written by runner on completion or failure

### Data Flow

```
CLI (submit/resume) → writes request.json
                         ↓
Daemon (polls .runs/) → finds created runs with request.json
                         ↓
TaskRunner → consumes request atomically, validates schema + security boundaries,
             invokes Engine, writes result.json
                         ↓
Engine (resolved by registry) → spawns CLI with appropriate flags
  ClaudeCodeEngine → `claude --print --output-format json`
  KimiCodeEngine   → `kimi --print --output-format stream-json -w <workspace>`
```

### Session State Machine

Transitions enforced by `SessionManager` with explicit allowlist:
- `created → running`
- `running → completed | failed | stopping`
- `stopping → completed | failed`
- `completed` and `failed` are terminal

### Crash Recovery

On daemon startup, `Reconciler` scans runs stuck in `running` state. Probes PID liveness — dead processes with `result.json` get state synced, dead processes without results get marked `failed` with `RUNNER_CRASH_RECOVERY`.

### Security Boundary

`TaskRunner` validates `workspace_path` against `allowed_roots` whitelist before execution to prevent path traversal.

## Key Modules

- **`src/cli/`** — Commander-based CLI with subcommands: submit, status, resume, stop, logs, doctor, start
- **`src/core/engine.ts`** — `Engine` interface (`start`, `send`, `stop`)
- **`src/core/runner.ts`** — `TaskRunner`: request consumption → validation → engine invocation → result writing
- **`src/core/daemon.ts`** — Polls `.runs/` directory, dispatches to TaskRunner
- **`src/core/run-manager.ts`** — Atomic file I/O for run directories (tmp→rename pattern)
- **`src/core/session-manager.ts`** — State machine enforcement
- **`src/core/reconciler.ts`** — Startup crash recovery
- **`src/engines/base-engine.ts`** — Shared exec/timeout/output-cap infrastructure for all engines
- **`src/engines/claude-code.ts`** — Spawns `claude` CLI, parses JSON output, extracts session_id and token_usage
- **`src/engines/kimi-code.ts`** — Spawns `kimi` CLI, parses stream-json NDJSON output
- **`src/engines/index.ts`** — Engine registry: `resolveEngine(name)` maps engine name to Engine instance
- **`src/schemas/`** — Zod schemas for request, result, session, and error codes

## Conventions

- **ES Modules** — `"type": "module"` in package.json. All imports in `src/` must use `.js` extensions (e.g., `import { foo } from './bar.js'`).
- **Node16 module resolution** — TypeScript `module` and `moduleResolution` both set to `Node16`.
- **Tests mirror src structure** — `tests/core/`, `tests/cli/`, `tests/engines/`, `tests/schemas/`, `tests/integration/`.
- **BDD/TDD methodology** — Write failing tests first, then implement to make them pass.
- **Zod for all schema validation** — Request, result, and session shapes validated at boundaries.
- **Atomic file writes** — Write to temp file, then `fs.renameSync` to final path (prevents partial reads).

## Environment Variables

| Variable | Purpose |
|---|---|
| `CODEBRIDGE_CLAUDE_PERMISSION_MODE` | Claude CLI permission mode (`bypassPermissions`, `acceptEdits`, etc.) |
| `CODEBRIDGE_POLL_INTERVAL_MS` | E2E script poll interval |
| `CODEBRIDGE_POLL_MAX` | E2E script max poll iterations |
| `CODEBRIDGE_REMOTE_DIR` | E2E script remote directory |

## PR 审查默认流程

- 当用户发来 PR 链接/列表要求 review 时，默认直接执行端到端审查，不只停留在建议。
- 必查三点：
  1) 是否真正解决问题。
  2) 更改是否合理（含回归风险、可维护性、测试覆盖）。
  3) 是否可直接合并，或必须修改后再合并。
- 有较大问题：在 PR 下给出阻塞评论（明确文件/风险/结论），不合并。
- 只有小问题：直接在对应 PR 分支修复、补测试并验证，通过后再合并。
- 审查结论要包含：每个 PR 的处理决定（merge / changes requested）和关键依据。

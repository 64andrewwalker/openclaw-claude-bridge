---
name: codebridge
description: Delegate complex coding tasks to another AI coding engine (Claude Code, Kimi Code, OpenCode, or Codex) via CLI, with structured results.
---

# CodeBridge — Task Delegation Skill

You can delegate complex, multi-file coding tasks to a separate AI coding engine instance via the `codebridge` CLI. The engine runs in its own process with its own context, executes the task, and returns structured results.

## Available Engines

| Engine | Session Resume | Token Tracking | Model Selection |
|--------|---------------|----------------|-----------------|
| `claude-code` | yes | yes | `--model opus`, `--model claude-sonnet-4-6` |
| `kimi-code` | no | no | `--model k2p5` |
| `opencode` | yes | yes | `--model pawpaw/claude-sonnet-4-5` |
| `codex` | yes | no | `--model gpt-5.3-codex` |

**How to choose:** Use `claude-code` (default) unless the task specifically requires another engine. Use `codebridge doctor` to check which engines are installed.

## When to Use

- The task requires working in a **different workspace** (another repo, another directory)
- The task is **complex enough** to benefit from a dedicated coding agent (multi-file refactor, feature implementation, debugging)
- You want **execution isolation** — the engine runs independently with its own context window

## When NOT to Use

- Simple single-file edits you can do directly
- Tasks in your current workspace that don't need isolation
- Read-only exploration (use your own tools instead)

## First-Time Setup

```bash
codebridge install
# Builds, links globally, outputs path to install guide at /tmp/codebridge-install.md
```

To verify which engines are available:

```bash
codebridge doctor
# Returns JSON with status of each engine CLI
```

## Submitting a Task

```bash
codebridge submit \
  --intent <coding|refactor|debug|ops> \
  --workspace <absolute-path> \
  --message "<clear task description>" \
  --engine <claude-code|kimi-code|opencode|codex> \
  --model <model-name> \
  --wait \
  --timeout 120000
```

- `--engine`: Which AI engine to use (default: `claude-code`)
- `--model`: Optional. Model name passed to the engine (format depends on engine, see table above)
- `--wait`: Block until task completes. Use for tasks under 5 minutes. Omit for longer tasks and poll with `codebridge status`.
- `--timeout`: Max execution time in ms (default: 1800000 = 30 min)

## Reading the Result

The result is JSON:

```json
{
  "run_id": "run-xyz",
  "status": "completed",
  "summary": "Implemented auth middleware...",
  "session_id": "session-abc",
  "files_changed": ["src/auth.ts", "src/middleware.ts"],
  "duration_ms": 15234,
  "token_usage": { "prompt_tokens": 1234, "completion_tokens": 567, "total_tokens": 1801 },
  "error": null
}
```

Key fields:
- **status**: `completed` or `failed`
- **summary**: What the engine did (first 2000 chars of output)
- **files_changed**: List of modified/created files in the workspace (null if not a git repo)
- **error.suggestion**: What to do if it failed (human-readable guidance)
- **error.retryable**: Whether automatic retry makes sense
- **session_id**: For sending follow-up messages via `resume`
- **token_usage**: Token counts (null for engines that don't track)

## Reporting Results to the User

**Success:** Report the summary and list files_changed. Example:
> Task completed in 15s. Modified files: src/auth.ts, src/middleware.ts, tests/auth.test.ts

**Failed + retryable:** Retry once automatically. If it fails again, report error.suggestion to the user.

**Failed + not retryable:** Report error.suggestion directly. Do not retry.

## Resuming a Session

To send a follow-up to an existing task:

```bash
codebridge resume <run_id> --message "<follow-up instruction>" --wait
```

Only works if the previous run has a `session_id`. Check with `codebridge status <run_id>` first.

## Polling (for long tasks)

```bash
# Submit without --wait
codebridge submit --intent coding --workspace /path --message "..." --engine claude-code

# Poll every 5 seconds
codebridge status <run_id>
# Look for state: "completed" or "failed"

# When done, read the result
# result.json is at .runs/<run_id>/result.json
```

## Error Reference

| Code | Retryable | What to Do |
|------|-----------|------------|
| ENGINE_TIMEOUT | yes | Increase --timeout or simplify the task |
| ENGINE_CRASH | yes | Retry the task |
| ENGINE_AUTH | no | Check engine credentials |
| NETWORK_ERROR | yes | Check network connectivity and retry |
| WORKSPACE_NOT_FOUND | no | Verify workspace path exists |
| WORKSPACE_INVALID | no | Use a permitted directory |
| REQUEST_INVALID | no | Fix intent/engine/workspace fields |
| RUNNER_CRASH_RECOVERY | yes | Retry the task |
| TASK_STOPPED | no | Task was manually stopped |

## All Commands

```bash
codebridge submit [options]       # Submit a new coding task
codebridge status <run_id>        # Query status of a run
codebridge resume <run_id>        # Send follow-up to existing session
codebridge stop <run_id>          # Force-stop a running task
codebridge logs <run_id>          # View task logs
codebridge doctor                 # Check environment (engines, paths)
codebridge install                # Build, link, generate install guide
codebridge start                  # Start daemon runner (watches for new tasks)
```

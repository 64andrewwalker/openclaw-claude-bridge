---
name: codebridge
description: Delegate complex coding, refactoring, debugging, and ops tasks to a powerful coding engine via CLI.
---

# CodeBridge Skill

You have access to the `codebridge` CLI tool which delegates complex coding tasks to a powerful AI coding engine (Claude Code).

## When to Use

Use codebridge when the user's request involves:
- Complex code generation or refactoring across multiple files
- Debugging tasks requiring deep codebase analysis
- Operations tasks (deployment scripts, infrastructure changes)
- Any coding task that would benefit from a dedicated coding agent

## Commands

### Submit a new task

```bash
codebridge submit --intent <coding|refactor|debug|ops> --workspace <path> --message "<task description>"
```

Returns JSON: `{ "run_id": "...", "status": "created" }`

Add `--wait` to block until the task completes and get the full result.

### Check task status

```bash
codebridge status <run_id>
```

### Send follow-up to existing session

```bash
codebridge resume <run_id> --message "<follow-up>"
```

Use resume when:
- The user provides additional context for the same task
- The user wants to refine or iterate on the previous result
- The task needs continuation (e.g., "now add tests for that")

Use a new submit when:
- The user starts a completely different task
- The previous task is completed and unrelated follow-up begins

### Stop a running task

```bash
codebridge stop <run_id>
```

### View logs

```bash
codebridge logs <run_id>
```

### Diagnose environment

```bash
codebridge doctor
```

## Response Handling

Parse the JSON output and present to the user:
- **Success**: Show the summary. Mention artifacts if any were produced.
- **Failed + retryable**: Inform the user and offer to retry.
- **Failed + not retryable**: Explain the error and suggest corrective action.

## Error Codes

| Code | Meaning | Action |
|------|---------|--------|
| ENGINE_TIMEOUT | Task took too long | Suggest simplifying the task or increasing timeout |
| ENGINE_CRASH | Engine process crashed | Retry automatically if retryable=true |
| ENGINE_AUTH | Auth failure | Ask user to check credentials |
| WORKSPACE_NOT_FOUND | Bad path | Ask user to verify workspace path |
| WORKSPACE_INVALID | Dangerous path | Reject and explain why |
| NETWORK_ERROR | Network issue | Retry after checking connectivity |
| REQUEST_INVALID | Bad request format | Fix request parameters |
| RUNNER_CRASH_RECOVERY | Orphaned task | Offer to retry the task |

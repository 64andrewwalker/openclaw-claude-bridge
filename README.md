# codebridge

File-driven bridge that delegates complex coding/ops tasks to AI coding engines (Claude Code, Codex, OpenCode) through a compliant, auditable workflow.

- PRD: `docs/PRD.md`
- Next: implement MVP runner + MCP adapter + OpenClaw skill

## E2E Real-Task Script

Run a full remote end-to-end scenario (new session + resume + new session) against `maestro-00`:

```bash
./scripts/e2e-bridge-real-task.sh
```

Useful options:

```bash
./scripts/e2e-bridge-real-task.sh --host maestro-00
./scripts/e2e-bridge-real-task.sh --skip-sync
```

Environment variables:
- `CODEBRIDGE_REMOTE_DIR` (default: `~/codebridge`)
- `CODEBRIDGE_CLAUDE_PERMISSION_MODE` (default: `bypassPermissions`)
- `CODEBRIDGE_POLL_INTERVAL_MS` (default: `700`)
- `CODEBRIDGE_POLL_MAX` (default: `180`)

#!/usr/bin/env bash
set -euo pipefail

HOST="maestro-00"
SKIP_SYNC=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host)
      HOST="${2:?missing value for --host}"
      shift 2
      ;;
    --skip-sync)
      SKIP_SYNC=1
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      echo "Usage: $0 [--host <ssh-host>] [--skip-sync]" >&2
      exit 2
      ;;
  esac
done

LOCAL_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REMOTE_DIR="${CODEBRIDGE_REMOTE_DIR:-~/openclaw-claude-bridge}"
PERMISSION_MODE="${CODEBRIDGE_CLAUDE_PERMISSION_MODE:-bypassPermissions}"
POLL_INTERVAL_MS="${CODEBRIDGE_POLL_INTERVAL_MS:-700}"
POLL_MAX="${CODEBRIDGE_POLL_MAX:-180}"

echo "[e2e] local repo: $LOCAL_REPO"
echo "[e2e] remote host: $HOST"
echo "[e2e] remote dir: $REMOTE_DIR"
echo "[e2e] permission mode: $PERMISSION_MODE"

if [[ "$SKIP_SYNC" -eq 0 ]]; then
  echo "[e2e] syncing repository to remote..."
  rsync -az --delete \
    --exclude '.git' \
    --exclude 'node_modules' \
    --exclude 'dist' \
    --exclude '.runs' \
    "$LOCAL_REPO/" "$HOST:$REMOTE_DIR/"
fi

echo "[e2e] installing dependencies and building on remote..."
ssh "$HOST" "zsh -lc 'export PATH=/opt/homebrew/bin:\$PATH; cd $REMOTE_DIR; npm ci; npm run build'"

echo "[e2e] running end-to-end scenario on remote..."
ssh "$HOST" "REMOTE_DIR='$REMOTE_DIR' PERMISSION_MODE='$PERMISSION_MODE' POLL_INTERVAL_MS='$POLL_INTERVAL_MS' POLL_MAX='$POLL_MAX' zsh -s" <<'REMOTE_SCRIPT'
set -euo pipefail
export PATH="/opt/homebrew/bin:$PATH"
set +x

if [[ "$REMOTE_DIR" == "~"* ]]; then
  REMOTE_DIR="${HOME}${REMOTE_DIR#\~}"
fi
cd "$REMOTE_DIR"

json_field() {
  local field="$1"
  node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);const v=j['$field'];if(v===undefined||v===null){return;}if(typeof v==='object'){process.stdout.write(JSON.stringify(v));}else{process.stdout.write(String(v));}})"
}

poll_run() {
  local run_id="$1"
  local label="$2"
  local state=""

  for i in $(seq 1 "$POLL_MAX"); do
    local status_out
    status_out="$(node dist/cli/index.js status "$run_id" --runs-dir "$RUNS_DIR")"
    state="$(printf '%s' "$status_out" | json_field state)"
    echo "[$label] poll=$i state=$state"
    if [[ "$state" == "completed" || "$state" == "failed" ]]; then
      break
    fi
    sleep 2
  done

  if [[ "$state" != "completed" && "$state" != "failed" ]]; then
    echo "[$label] timeout while waiting for completion" >&2
    return 1
  fi

  if [[ "$state" == "failed" ]]; then
    echo "[$label] run failed" >&2
    cat "$RUNS_DIR/$run_id/result.json" >&2
    return 1
  fi
}

RUNS_DIR="$REMOTE_DIR/.runs-e2e-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$RUNS_DIR"
echo "[e2e] runs dir: $RUNS_DIR"

cleanup() {
  if [[ -n "${DAEMON_PID:-}" ]]; then
    kill "$DAEMON_PID" >/dev/null 2>&1 || true
    wait "$DAEMON_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

CODEBRIDGE_CLAUDE_PERMISSION_MODE="$PERMISSION_MODE" \
nohup node dist/cli/index.js start --runs-dir "$RUNS_DIR" --poll-interval "$POLL_INTERVAL_MS" \
  > "$RUNS_DIR/daemon.out" 2>&1 &
DAEMON_PID=$!
sleep 1
echo "[e2e] daemon pid: $DAEMON_PID"

MSG1="$(cat <<'EOF'
Execute this task directly on the machine.

Install and configure a high-quality zsh setup for user aria-maestro-00:
- Ensure oh-my-zsh is installed (unattended)
- Ensure plugins installed: zsh-autosuggestions, zsh-syntax-highlighting, zsh-completions
- Backup ~/.zshrc to ~/.zshrc.backup.codebridge.<timestamp>
- Update ~/.zshrc idempotently with plugin list and tuning:
  HISTSIZE=50000
  SAVEHIST=50000
  setopt HIST_IGNORE_ALL_DUPS SHARE_HISTORY AUTO_CD
  alias ll='ls -lah'
  alias gs='git status -sb'
  alias k='kubectl'
- Keep unrelated user content intact.
- Validate by running:
  zsh --version
  zsh -ic 'echo ZSH_OK && typeset -p plugins 2>/dev/null | head -n 1'
  and checking plugin dirs exist.

Return concise summary: actions taken, files changed, verification results.
EOF
)"

SUBMIT1="$(node dist/cli/index.js submit --intent ops --workspace "$HOME" --message "$MSG1" --runs-dir "$RUNS_DIR")"
RUN1_ID="$(printf '%s' "$SUBMIT1" | json_field run_id)"
echo "[run1] id=$RUN1_ID"
poll_run "$RUN1_ID" "run1"

RUN1_SESSION="$(cat "$RUNS_DIR/$RUN1_ID/session.json" | json_field session_id)"
echo "[run1] session_id=$RUN1_SESSION"

[[ -d "$HOME/.oh-my-zsh" ]]
[[ -d "$HOME/.oh-my-zsh/custom/plugins/zsh-autosuggestions" ]]
[[ -d "$HOME/.oh-my-zsh/custom/plugins/zsh-syntax-highlighting" ]]
[[ -d "$HOME/.oh-my-zsh/custom/plugins/zsh-completions" ]]
grep -q '^HISTSIZE=50000' "$HOME/.zshrc"
grep -q '^SAVEHIST=50000' "$HOME/.zshrc"
grep -q 'setopt HIST_IGNORE_ALL_DUPS SHARE_HISTORY AUTO_CD' "$HOME/.zshrc"
grep -q 'alias gs=' "$HOME/.zshrc"
grep -q 'alias k=' "$HOME/.zshrc"
grep -q 'alias ll=' "$HOME/.zshrc"
zsh -ic 'echo ZSH_OK && typeset -p plugins 2>/dev/null | head -n 1'

MSG2="$(cat <<'EOF'
Continue this same task and update the existing setup safely.

Do these follow-up improvements:
1) Add a clearly marked "codebridge-managed" block in ~/.zshrc (idempotent).
2) In that block, add:
   - autoload -Uz compinit && compinit (or comment if already done by omz)
   - export EDITOR=vim
   - alias cls='clear'
3) Ensure existing aliases gs/k/ll remain correct and not duplicated.
4) Run verification commands and include outputs:
   - zsh -ic 'echo RESUME_OK; alias gs; alias k; alias cls; echo EDITOR=$EDITOR'
5) Provide concise summary of what changed in this resume step.
EOF
)"

RESUME1="$(node dist/cli/index.js resume "$RUN1_ID" --message "$MSG2" --runs-dir "$RUNS_DIR")"
echo "[run1-resume] status=$(printf '%s' "$RESUME1" | json_field status)"
poll_run "$RUN1_ID" "run1-resume"

RUN1_SESSION_AFTER="$(cat "$RUNS_DIR/$RUN1_ID/session.json" | json_field session_id)"
if [[ "$RUN1_SESSION" != "$RUN1_SESSION_AFTER" ]]; then
  echo "[run1-resume] session mismatch: before=$RUN1_SESSION after=$RUN1_SESSION_AFTER" >&2
  exit 1
fi
grep -q 'codebridge-managed' "$HOME/.zshrc"
grep -q "alias cls=" "$HOME/.zshrc"
zsh -ic 'echo RESUME_OK; alias gs; alias k; alias cls; echo EDITOR=$EDITOR'

MSG3="$(cat <<'EOF'
Start a NEW independent task.

Create a practical zsh tuning report at:
~/openclaw-claude-bridge/zsh-tuning-report.md

Requirements:
1) Measure interactive startup time baseline with 5 runs:
   /usr/bin/time zsh -i -c exit
2) Review current ~/.zshrc and identify startup overhead risks.
3) Apply at most 1 safe optimization if beneficial (idempotent).
4) Re-measure startup time with 5 runs.
5) Write report markdown with:
   - date/time
   - before/after timing snapshot
   - changes applied
   - recommendation list (top 3)
6) In response, include report path and short executive summary.
EOF
)"

SUBMIT2="$(node dist/cli/index.js submit --intent ops --workspace "$HOME/openclaw-claude-bridge" --message "$MSG3" --runs-dir "$RUNS_DIR")"
RUN2_ID="$(printf '%s' "$SUBMIT2" | json_field run_id)"
echo "[run2] id=$RUN2_ID"
poll_run "$RUN2_ID" "run2"

RUN2_SESSION="$(cat "$RUNS_DIR/$RUN2_ID/session.json" | json_field session_id)"
if [[ -z "$RUN1_SESSION" || -z "$RUN2_SESSION" ]]; then
  echo "[run2] missing session id(s): run1=$RUN1_SESSION run2=$RUN2_SESSION" >&2
  exit 1
fi
if [[ "$RUN1_SESSION" == "$RUN2_SESSION" ]]; then
  echo "[run2] expected new session id, got same as run1: $RUN2_SESSION" >&2
  exit 1
fi

REPORT_PATH="$HOME/openclaw-claude-bridge/zsh-tuning-report.md"
[[ -s "$REPORT_PATH" ]]

echo "[e2e] completed successfully"
echo "RUNS_DIR=$RUNS_DIR"
echo "RUN1_ID=$RUN1_ID"
echo "RUN1_SESSION=$RUN1_SESSION"
echo "RUN2_ID=$RUN2_ID"
echo "RUN2_SESSION=$RUN2_SESSION"
echo "REPORT_PATH=$REPORT_PATH"
echo "DAEMON_LOG=$RUNS_DIR/daemon.out"
REMOTE_SCRIPT

echo "[e2e] done"

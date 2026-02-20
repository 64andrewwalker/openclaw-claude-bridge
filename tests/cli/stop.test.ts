import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { RunManager } from '../../src/core/run-manager.js';
import { SessionManager } from '../../src/core/session-manager.js';

const CLI = 'npx tsx src/cli/index.ts';
const CWD = process.cwd();

describe('codebridge stop', () => {
  let runsDir: string;
  let workspaceDir: string;

  beforeEach(() => {
    runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-stop-runs-'));
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-stop-ws-'));
  });

  afterEach(() => {
    fs.rmSync(runsDir, { recursive: true, force: true });
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });

  it('stops a running run and writes failed result', async () => {
    const runManager = new RunManager(runsDir);
    const sessionManager = new SessionManager(runManager);
    const runId = await runManager.createRun({
      task_id: 'task-stop-cli',
      intent: 'coding',
      workspace_path: workspaceDir,
      message: 'Long task',
      engine: 'claude-code',
      mode: 'new',
    });

    const child = spawn('sleep', ['60']);
    await sessionManager.transition(runId, 'running', { pid: child.pid });

    const stdout = execSync(
      `${CLI} stop ${runId} --runs-dir "${runsDir}" --force-timeout 200`,
      { encoding: 'utf-8', cwd: CWD }
    );
    const out = JSON.parse(stdout.trim());
    expect(out.status).toBe('stopped');

    const session = await runManager.getStatus(runId);
    expect(session.state).toBe('failed');

    const result = JSON.parse(fs.readFileSync(path.join(runsDir, runId, 'result.json'), 'utf-8'));
    expect(result.status).toBe('failed');
    expect(result.error.code).toBe('TASK_STOPPED');
    expect(result.error.retryable).toBe(false);

    try { process.kill(child.pid!, 'SIGKILL'); } catch { /* already exited */ }
  });
});

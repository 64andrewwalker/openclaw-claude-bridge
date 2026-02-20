// tests/core/stop.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RunManager } from '../../src/core/run-manager';
import { SessionManager } from '../../src/core/session-manager';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawn } from 'node:child_process';

describe('Stop lifecycle', () => {
  let runsDir: string;
  let runManager: RunManager;
  let sessionManager: SessionManager;

  beforeEach(() => {
    runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-stop-'));
    runManager = new RunManager(runsDir);
    sessionManager = new SessionManager(runManager);
  });

  afterEach(() => {
    fs.rmSync(runsDir, { recursive: true, force: true });
  });

  it('stop transitions running → stopping → completed with result.json', async () => {
    // Create a run and set it to running with a real sleep process
    const runId = await runManager.createRun({
      task_id: 'task-stop', intent: 'coding', workspace_path: '/tmp',
      message: 'Long task', engine: 'claude-code', mode: 'new',
    });

    // Start a sleep process we can kill
    const child = spawn('sleep', ['60']);
    await sessionManager.transition(runId, 'running', { pid: child.pid! });

    // Now simulate stop: transition to stopping, kill, then complete
    await sessionManager.transition(runId, 'stopping');
    child.kill('SIGTERM');

    // Wait for exit
    await new Promise(resolve => child.on('close', resolve));

    await sessionManager.transition(runId, 'completed');
    await runManager.writeResult(runId, {
      run_id: runId, status: 'completed', summary: 'Force-stopped',
      session_id: null, artifacts: [], duration_ms: 0, token_usage: null,
    });

    const session = await runManager.getStatus(runId);
    expect(session.state).toBe('completed');

    const resultPath = path.join(runsDir, runId, 'result.json');
    expect(fs.existsSync(resultPath)).toBe(true);
    const result = JSON.parse(fs.readFileSync(resultPath, 'utf-8'));
    expect(result.status).toBe('completed');
    expect(result.summary).toContain('Force-stopped');
  });
});

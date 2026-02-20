import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Daemon } from '../../src/core/daemon.js';
import { RunManager } from '../../src/core/run-manager.js';
import { ClaudeCodeEngine } from '../../src/engines/claude-code.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('Daemon', () => {
  let runsDir: string;
  let workspaceDir: string;

  beforeEach(() => {
    runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-daemon-'));
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-daemon-ws-'));
  });

  afterEach(() => {
    fs.rmSync(runsDir, { recursive: true, force: true });
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });

  it('picks up new request and processes it', async () => {
    const engine = new ClaudeCodeEngine({ command: 'echo', defaultArgs: ['daemon processed'] });
    const daemon = new Daemon(runsDir, engine, 200); // fast poll for testing

    await daemon.start();

    // Create a run manually (simulating CLI submit --no-wait)
    const runManager = new RunManager(runsDir);
    const runId = await runManager.createRun({
      task_id: 'task-001', intent: 'coding', workspace_path: workspaceDir,
      message: 'Test daemon', engine: 'claude-code', mode: 'new',
    });

    // Wait for daemon to pick it up and process
    await new Promise(resolve => setTimeout(resolve, 1500));

    await daemon.stop();

    // Check result.json exists
    const resultPath = path.join(runsDir, runId, 'result.json');
    expect(fs.existsSync(resultPath)).toBe(true);
    const result = JSON.parse(fs.readFileSync(resultPath, 'utf-8'));
    expect(result.status).toBe('completed');
  });

  it('reconciles orphaned runs on startup', async () => {
    // Create a run manually with state "running" and dead pid
    const runManager = new RunManager(runsDir);
    const runId = await runManager.createRun({
      task_id: 'task-orphan', intent: 'coding', workspace_path: '/tmp',
      message: 'Orphan', engine: 'claude-code', mode: 'new',
    });
    await runManager.updateSession(runId, { state: 'running', pid: 99999 });

    const engine = new ClaudeCodeEngine({ command: 'echo', defaultArgs: ['ok'] });
    const daemon = new Daemon(runsDir, engine, 200);
    await daemon.start();

    // Give it a moment for reconciliation
    await new Promise(resolve => setTimeout(resolve, 500));
    await daemon.stop();

    const session = await runManager.getStatus(runId);
    expect(session.state).toBe('failed');
  });

  it('ignores already-processed runs', async () => {
    const engine = new ClaudeCodeEngine({ command: 'echo', defaultArgs: ['ok'] });
    const daemon = new Daemon(runsDir, engine, 200);

    // Create a run and manually consume it (simulating already processed)
    const runManager = new RunManager(runsDir);
    const runId = await runManager.createRun({
      task_id: 'task-done', intent: 'coding', workspace_path: workspaceDir,
      message: 'Already done', engine: 'claude-code', mode: 'new',
    });
    await runManager.consumeRequest(runId); // consumes request.json -> request.processing.json
    await runManager.updateSession(runId, { state: 'completed' });

    await daemon.start();
    await new Promise(resolve => setTimeout(resolve, 500));
    await daemon.stop();

    // Should NOT have a second result.json or state change
    const session = await runManager.getStatus(runId);
    expect(session.state).toBe('completed');
  });
});

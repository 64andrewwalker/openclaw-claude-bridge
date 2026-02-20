import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TaskRunner } from '../../src/core/runner.js';
import { RunManager } from '../../src/core/run-manager.js';
import { SessionManager } from '../../src/core/session-manager.js';
import { ClaudeCodeEngine } from '../../src/engines/claude-code.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('TaskRunner', () => {
  let runsDir: string;
  let workspaceDir: string;
  let runManager: RunManager;
  let sessionManager: SessionManager;

  beforeEach(() => {
    runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codebridge-runner-'));
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codebridge-workspace-'));
    runManager = new RunManager(runsDir);
    sessionManager = new SessionManager(runManager);
  });

  afterEach(() => {
    fs.rmSync(runsDir, { recursive: true, force: true });
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });

  it('executes a task end-to-end producing result.json', async () => {
    const engine = new ClaudeCodeEngine({ command: 'echo', defaultArgs: ['task completed successfully'] });
    const runner = new TaskRunner(runManager, sessionManager, engine);
    const runId = await runManager.createRun({
      task_id: 'task-001', intent: 'coding', workspace_path: workspaceDir,
      message: 'Add login', engine: 'claude-code', mode: 'new',
    });

    await runner.processRun(runId);

    const session = await sessionManager.getSession(runId);
    expect(session.state).toBe('completed');

    const resultPath = path.join(runsDir, runId, 'result.json');
    expect(fs.existsSync(resultPath)).toBe(true);
    const result = JSON.parse(fs.readFileSync(resultPath, 'utf-8'));
    expect(result.status).toBe('completed');
    expect(result.summary).toContain('task completed');
    expect(result.duration_ms).toBeTypeOf('number');
  });

  it('handles engine failure and writes error to result', async () => {
    const engine = new ClaudeCodeEngine({ command: 'false' });
    const runner = new TaskRunner(runManager, sessionManager, engine);
    const runId = await runManager.createRun({
      task_id: 'task-001', intent: 'coding', workspace_path: workspaceDir,
      message: 'Will fail', engine: 'claude-code', mode: 'new',
    });

    await runner.processRun(runId);

    const session = await sessionManager.getSession(runId);
    expect(session.state).toBe('failed');

    const resultPath = path.join(runsDir, runId, 'result.json');
    const result = JSON.parse(fs.readFileSync(resultPath, 'utf-8'));
    expect(result.status).toBe('failed');
    expect(result.error.code).toBe('ENGINE_CRASH');
    expect(result.error.retryable).toBe(true);
  });

  it('rejects non-existent workspace without invoking engine', async () => {
    const engine = new ClaudeCodeEngine({ command: 'echo', defaultArgs: ['should not run'] });
    const runner = new TaskRunner(runManager, sessionManager, engine);
    const runId = await runManager.createRun({
      task_id: 'task-001', intent: 'coding', workspace_path: '/nonexistent/path/12345',
      message: 'Bad workspace', engine: 'claude-code', mode: 'new',
    });

    await runner.processRun(runId);

    const session = await sessionManager.getSession(runId);
    expect(session.state).toBe('failed');

    const resultPath = path.join(runsDir, runId, 'result.json');
    const result = JSON.parse(fs.readFileSync(resultPath, 'utf-8'));
    expect(result.error.code).toBe('WORKSPACE_NOT_FOUND');
    expect(result.error.retryable).toBe(false);
  });
});

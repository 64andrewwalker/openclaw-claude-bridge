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

  it('rejects request with workspace outside allowed_roots', async () => {
    const engine = new ClaudeCodeEngine({ command: 'echo', defaultArgs: ['should not run'] });
    const runner = new TaskRunner(runManager, sessionManager, engine);
    const runId = await runManager.createRun({
      task_id: 'task-sec', intent: 'coding', workspace_path: workspaceDir,
      message: 'Test', engine: 'claude-code', mode: 'new',
      allowed_roots: ['/some/other/path'],
    });
    await runner.processRun(runId);
    const session = await sessionManager.getSession(runId);
    expect(session.state).toBe('failed');
    const resultPath = path.join(runsDir, runId, 'result.json');
    const result = JSON.parse(fs.readFileSync(resultPath, 'utf-8'));
    expect(result.error.code).toBe('WORKSPACE_INVALID');
  });

  it('rejects path traversal attempts', async () => {
    // Use a sibling of workspaceDir to escape allowed_roots without hitting DANGEROUS_ROOTS
    const siblingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codebridge-sibling-'));
    try {
      const engine = new ClaudeCodeEngine({ command: 'echo', defaultArgs: ['should not run'] });
      const runner = new TaskRunner(runManager, sessionManager, engine);
      const traversalPath = path.join(workspaceDir, '..', path.basename(siblingDir));
      const runId = await runManager.createRun({
        task_id: 'task-traversal', intent: 'coding',
        workspace_path: traversalPath,
        message: 'Traversal', engine: 'claude-code', mode: 'new',
        allowed_roots: [workspaceDir],
      });
      await runner.processRun(runId);
      const resultPath = path.join(runsDir, runId, 'result.json');
      const result = JSON.parse(fs.readFileSync(resultPath, 'utf-8'));
      expect(result.error.code).toBe('WORKSPACE_INVALID');
    } finally {
      fs.rmSync(siblingDir, { recursive: true, force: true });
    }
  });

  it('rejects filesystem root as allowed_root', async () => {
    const engine = new ClaudeCodeEngine({ command: 'echo', defaultArgs: ['should not run'] });
    const runner = new TaskRunner(runManager, sessionManager, engine);
    const runId = await runManager.createRun({
      task_id: 'task-fsroot', intent: 'coding', workspace_path: workspaceDir,
      message: 'Root escape', engine: 'claude-code', mode: 'new',
      allowed_roots: ['/'],
    });
    await runner.processRun(runId);
    const resultPath = path.join(runsDir, runId, 'result.json');
    const result = JSON.parse(fs.readFileSync(resultPath, 'utf-8'));
    expect(result.error.code).toBe('WORKSPACE_INVALID');
    expect(result.error.message).toContain('not permitted');
  });

  it('rejects sibling-prefix path that shares allowed_root prefix', async () => {
    const evilDir = fs.mkdtempSync(workspaceDir + '-evil');
    try {
      const engine = new ClaudeCodeEngine({ command: 'echo', defaultArgs: ['should not run'] });
      const runner = new TaskRunner(runManager, sessionManager, engine);
      const runId = await runManager.createRun({
        task_id: 'task-sibling', intent: 'coding',
        workspace_path: evilDir,
        message: 'Sibling prefix', engine: 'claude-code', mode: 'new',
        allowed_roots: [workspaceDir],
      });
      await runner.processRun(runId);
      const resultPath = path.join(runsDir, runId, 'result.json');
      const result = JSON.parse(fs.readFileSync(resultPath, 'utf-8'));
      expect(result.error.code).toBe('WORKSPACE_INVALID');
    } finally {
      fs.rmSync(evilDir, { recursive: true, force: true });
    }
  });

  it('allows workspace within allowed_roots', async () => {
    const engine = new ClaudeCodeEngine({ command: 'echo', defaultArgs: ['secure ok'] });
    const runner = new TaskRunner(runManager, sessionManager, engine);
    const subDir = path.join(workspaceDir, 'subproject');
    fs.mkdirSync(subDir);
    const runId = await runManager.createRun({
      task_id: 'task-ok', intent: 'coding', workspace_path: subDir,
      message: 'OK', engine: 'claude-code', mode: 'new',
      allowed_roots: [workspaceDir],
    });
    await runner.processRun(runId);
    const session = await sessionManager.getSession(runId);
    expect(session.state).toBe('completed');
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

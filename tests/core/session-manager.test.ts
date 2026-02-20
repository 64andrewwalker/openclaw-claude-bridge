import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SessionManager } from '../../src/core/session-manager.js';
import { RunManager } from '../../src/core/run-manager.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('SessionManager', () => {
  let runsDir: string;
  let runManager: RunManager;
  let sessionManager: SessionManager;

  const createTestRun = () => runManager.createRun({
    task_id: 'task-001', intent: 'coding', workspace_path: '/tmp/project',
    message: 'Add login', engine: 'claude-code', mode: 'new',
  });

  beforeEach(() => {
    runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codebridge-session-'));
    runManager = new RunManager(runsDir);
    sessionManager = new SessionManager(runManager);
  });

  afterEach(() => { fs.rmSync(runsDir, { recursive: true, force: true }); });

  it('initializes session in created state', async () => {
    const runId = await createTestRun();
    const session = await sessionManager.getSession(runId);
    expect(session.state).toBe('created');
  });

  it('transitions created -> running with pid and session_id', async () => {
    const runId = await createTestRun();
    await sessionManager.transition(runId, 'running', { pid: 12345, session_id: 'sess-abc' });
    const session = await sessionManager.getSession(runId);
    expect(session.state).toBe('running');
    expect(session.pid).toBe(12345);
    expect(session.session_id).toBe('sess-abc');
  });

  it('transitions running -> completed', async () => {
    const runId = await createTestRun();
    await sessionManager.transition(runId, 'running', { pid: 12345 });
    await sessionManager.transition(runId, 'completed');
    const session = await sessionManager.getSession(runId);
    expect(session.state).toBe('completed');
  });

  it('transitions running -> failed', async () => {
    const runId = await createTestRun();
    await sessionManager.transition(runId, 'running', { pid: 12345 });
    await sessionManager.transition(runId, 'failed');
    const session = await sessionManager.getSession(runId);
    expect(session.state).toBe('failed');
  });

  it('transitions running -> stopping', async () => {
    const runId = await createTestRun();
    await sessionManager.transition(runId, 'running', { pid: 12345 });
    await sessionManager.transition(runId, 'stopping');
    const session = await sessionManager.getSession(runId);
    expect(session.state).toBe('stopping');
  });

  it('transitions stopping -> completed', async () => {
    const runId = await createTestRun();
    await sessionManager.transition(runId, 'running', { pid: 12345 });
    await sessionManager.transition(runId, 'stopping');
    await sessionManager.transition(runId, 'completed');
    const session = await sessionManager.getSession(runId);
    expect(session.state).toBe('completed');
  });

  it('transitions stopping -> failed', async () => {
    const runId = await createTestRun();
    await sessionManager.transition(runId, 'running', { pid: 12345 });
    await sessionManager.transition(runId, 'stopping');
    await sessionManager.transition(runId, 'failed');
    const session = await sessionManager.getSession(runId);
    expect(session.state).toBe('failed');
  });

  it('rejects invalid transition completed -> running', async () => {
    const runId = await createTestRun();
    await sessionManager.transition(runId, 'running', { pid: 12345 });
    await sessionManager.transition(runId, 'completed');
    await expect(sessionManager.transition(runId, 'running')).rejects.toThrow(/invalid state transition/i);
  });

  it('rejects invalid transition created -> completed', async () => {
    const runId = await createTestRun();
    await expect(sessionManager.transition(runId, 'completed')).rejects.toThrow(/invalid state transition/i);
  });

  it('rejects invalid transition failed -> running', async () => {
    const runId = await createTestRun();
    await sessionManager.transition(runId, 'running', { pid: 12345 });
    await sessionManager.transition(runId, 'failed');
    await expect(sessionManager.transition(runId, 'running')).rejects.toThrow(/invalid state transition/i);
  });

  it('returns updated session from transition', async () => {
    const runId = await createTestRun();
    const result = await sessionManager.transition(runId, 'running', { pid: 99999, session_id: 'sess-xyz' });
    expect(result.state).toBe('running');
    expect(result.pid).toBe(99999);
    expect(result.session_id).toBe('sess-xyz');
  });

  it('resetForResume resets completed session to created', async () => {
    const runId = await createTestRun();
    await sessionManager.transition(runId, 'running', { pid: 12345 });
    await sessionManager.transition(runId, 'completed');
    await sessionManager.resetForResume(runId);
    const session = await sessionManager.getSession(runId);
    expect(session.state).toBe('created');
  });

  it('resetForResume resets failed session to created', async () => {
    const runId = await createTestRun();
    await sessionManager.transition(runId, 'running', { pid: 12345 });
    await sessionManager.transition(runId, 'failed');
    await sessionManager.resetForResume(runId);
    const session = await sessionManager.getSession(runId);
    expect(session.state).toBe('created');
  });

  it('resetForResume rejects running session', async () => {
    const runId = await createTestRun();
    await sessionManager.transition(runId, 'running', { pid: 12345 });
    await expect(sessionManager.resetForResume(runId)).rejects.toThrow(/cannot resume from state/i);
  });
});

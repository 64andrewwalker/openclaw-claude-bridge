import { describe, it, expect, beforeAll } from 'vitest';
import { mkdirSync } from 'node:fs';
import { ClaudeCodeEngine } from '../../src/engines/claude-code';
import type { TaskRequest } from '../../src/schemas/request';

describe('ClaudeCodeEngine', () => {
  beforeAll(() => {
    mkdirSync('/tmp/cb-test-project', { recursive: true });
  });

  const makeRequest = (overrides?: Partial<TaskRequest>): TaskRequest => ({
    task_id: 'task-001',
    intent: 'coding',
    workspace_path: '/tmp/cb-test-project',
    message: 'Hello world',
    engine: 'claude-code',
    mode: 'new',
    session_id: null,
    constraints: { timeout_ms: 30000, allow_network: true },
    ...overrides,
  });

  it('starts a new session and returns pid and output', async () => {
    const engine = new ClaudeCodeEngine({ command: 'echo', defaultArgs: ['hello from engine'] });
    const result = await engine.start(makeRequest());
    expect(result.pid).toBeTypeOf('number');
    expect(result.output).toContain('hello from engine');
    expect(result.error).toBeUndefined();
  });

  it('returns ENGINE_CRASH on non-zero exit code', async () => {
    const engine = new ClaudeCodeEngine({ command: 'false' });
    const result = await engine.start(makeRequest());
    expect(result.error).toBeDefined();
    expect(result.error?.code).toBe('ENGINE_CRASH');
    expect(result.error?.retryable).toBe(true);
  });

  it('kills process on timeout and returns ENGINE_TIMEOUT', async () => {
    const engine = new ClaudeCodeEngine({ command: 'sleep', defaultArgs: ['10'] });
    const result = await engine.start(makeRequest({ constraints: { timeout_ms: 500, allow_network: true } }));
    expect(result.error).toBeDefined();
    expect(result.error?.code).toBe('ENGINE_TIMEOUT');
    expect(result.error?.retryable).toBe(true);
  }, 10000);

  it('handles command not found error', async () => {
    const engine = new ClaudeCodeEngine({ command: 'nonexistent-command-xyz' });
    const result = await engine.start(makeRequest());
    expect(result.error).toBeDefined();
    expect(result.error?.code).toBe('ENGINE_CRASH');
  });

  it('stop() does not throw for non-existent pid', async () => {
    const engine = new ClaudeCodeEngine();
    await expect(engine.stop(999999)).resolves.not.toThrow();
  });
});

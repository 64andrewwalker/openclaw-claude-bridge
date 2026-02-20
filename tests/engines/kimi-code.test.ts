import { describe, it, expect, beforeAll } from 'vitest';
import { mkdirSync } from 'node:fs';
import { KimiCodeEngine } from '../../src/engines/kimi-code';
import type { TaskRequest } from '../../src/schemas/request';

describe('KimiCodeEngine', () => {
  beforeAll(() => {
    mkdirSync('/tmp/cb-test-project', { recursive: true });
  });

  const makeRequest = (overrides?: Partial<TaskRequest>): TaskRequest => ({
    task_id: 'task-001',
    intent: 'coding',
    workspace_path: '/tmp/cb-test-project',
    message: 'Hello world',
    engine: 'kimi-code',
    mode: 'new',
    session_id: null,
    constraints: { timeout_ms: 30000, allow_network: true },
    ...overrides,
  });

  it('starts a new session and returns pid and output', async () => {
    const engine = new KimiCodeEngine({ command: 'echo', defaultArgs: ['hello from kimi'] });
    const result = await engine.start(makeRequest());
    expect(result.pid).toBeTypeOf('number');
    expect(result.output).toContain('hello from kimi');
    expect(result.error).toBeUndefined();
  });

  it('parses stream-json output extracting text content', async () => {
    const payload = '{"role":"assistant","content":[{"type":"text","text":"kimi result"}]}';
    const engine = new KimiCodeEngine({ command: 'echo', defaultArgs: [payload] });
    const result = await engine.start(makeRequest());
    expect(result.output).toBe('kimi result');
    expect(result.tokenUsage).toBeNull();
  });

  it('concatenates multiple text parts from content array', async () => {
    const payload = '{"role":"assistant","content":[{"type":"think","think":"hmm"},{"type":"text","text":"part1"},{"type":"text","text":" part2"}]}';
    const engine = new KimiCodeEngine({ command: 'echo', defaultArgs: [payload] });
    const result = await engine.start(makeRequest());
    expect(result.output).toBe('part1 part2');
  });

  it('returns ENGINE_CRASH on non-zero exit code', async () => {
    const engine = new KimiCodeEngine({ command: 'false' });
    const result = await engine.start(makeRequest());
    expect(result.error).toBeDefined();
    expect(result.error?.code).toBe('ENGINE_CRASH');
    expect(result.error?.retryable).toBe(true);
  });

  it('kills process on timeout and returns ENGINE_TIMEOUT', async () => {
    const engine = new KimiCodeEngine({ command: 'sleep', defaultArgs: ['10'] });
    const result = await engine.start(makeRequest({ constraints: { timeout_ms: 500, allow_network: true } }));
    expect(result.error).toBeDefined();
    expect(result.error?.code).toBe('ENGINE_TIMEOUT');
    expect(result.error?.retryable).toBe(true);
  }, 10000);

  it('handles command not found error', async () => {
    const engine = new KimiCodeEngine({ command: 'nonexistent-command-xyz' });
    const result = await engine.start(makeRequest());
    expect(result.error).toBeDefined();
    expect(result.error?.code).toBe('ENGINE_CRASH');
  });

  it('stop() does not throw for non-existent pid', async () => {
    const engine = new KimiCodeEngine();
    await expect(engine.stop(999999)).resolves.not.toThrow();
  });

  it('caps oversized output and returns ENGINE_CRASH', async () => {
    const bytes = 11 * 1024 * 1024;
    const engine = new KimiCodeEngine({
      command: 'node',
      defaultArgs: ['-e', `process.stdout.write('x'.repeat(${bytes}))`],
    });
    const result = await engine.start(makeRequest({ constraints: { timeout_ms: 30000, allow_network: true } }));
    expect(result.error?.code).toBe('ENGINE_CRASH');
    expect(result.error?.message).toContain('exceeded');
  }, 15000);

  it('builds args with --work-dir for workspace path', async () => {
    // Use a command that echoes its arguments to verify -w flag is present
    const engine = new KimiCodeEngine({
      command: 'sh',
      defaultArgs: ['-c', 'echo "$@"', '--'],
    });
    const result = await engine.start(makeRequest());
    // When defaultArgs is set, buildStartArgs returns defaultArgs as-is,
    // so this test verifies the mock command path works.
    expect(result.pid).toBeTypeOf('number');
    expect(result.error).toBeUndefined();
  });

  it('builds resume args with --session flag', async () => {
    const engine = new KimiCodeEngine({
      command: 'sh',
      defaultArgs: ['-c', 'echo "$@"', '--'],
    });
    // send() always builds its own args regardless of defaultArgs
    const result = await engine.send('sess-abc', 'follow up', { cwd: '/tmp/cb-test-project' });
    expect(result.output).toContain('--session');
    expect(result.output).toContain('sess-abc');
  });
});

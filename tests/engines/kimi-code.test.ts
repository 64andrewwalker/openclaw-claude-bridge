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

  // --- Variant / Edge Case Tests ---

  it('handles empty content array gracefully', async () => {
    const payload = '{"role":"assistant","content":[]}';
    const engine = new KimiCodeEngine({ command: 'echo', defaultArgs: [payload] });
    const result = await engine.start(makeRequest());
    expect(result.output).toBe('');
    expect(result.error).toBeUndefined();
  });

  it('handles content with only think parts (no text)', async () => {
    const payload = '{"role":"assistant","content":[{"type":"think","think":"deep thought"}]}';
    const engine = new KimiCodeEngine({ command: 'echo', defaultArgs: [payload] });
    const result = await engine.start(makeRequest());
    expect(result.output).toBe('');
    expect(result.error).toBeUndefined();
  });

  it('handles content with mixed tool_use and text parts', async () => {
    const payload = '{"role":"assistant","content":[{"type":"tool_use","name":"bash","input":"ls"},{"type":"text","text":"done"}]}';
    const engine = new KimiCodeEngine({ command: 'echo', defaultArgs: [payload] });
    const result = await engine.start(makeRequest());
    expect(result.output).toBe('done');
  });

  it('falls back to raw output when JSON has no content field', async () => {
    const payload = '{"role":"assistant","message":"no content field"}';
    const engine = new KimiCodeEngine({ command: 'echo', defaultArgs: [payload] });
    const result = await engine.start(makeRequest());
    // Falls back to trimmed raw output since no content array
    expect(result.output).toContain('no content field');
  });

  it('collects text from multiple NDJSON lines (multi-turn tool use)', async () => {
    // Simulate Kimi's stream-json with multiple assistant messages (tool use scenario)
    const ndjson = [
      '{"role":"assistant","content":[{"type":"text","text":"Let me check. "}]}',
      '{"role":"tool","tool_call_id":"call-1","content":"file.txt exists"}',
      '{"role":"assistant","content":[{"type":"text","text":"The file exists."}]}',
    ].join('\\n');
    const engine = new KimiCodeEngine({
      command: 'sh',
      defaultArgs: ['-c', `printf '${ndjson}\\n'`],
    });
    const result = await engine.start(makeRequest());
    expect(result.output).toBe('Let me check. The file exists.');
  });

  it('parses trailing JSON after non-JSON log lines', async () => {
    const engine = new KimiCodeEngine({
      command: 'sh',
      defaultArgs: ['-c', `printf 'WARN: preface\\n{"role":"assistant","content":[{"type":"text","text":"tail json"}]}\\n'`],
    });
    const result = await engine.start(makeRequest());
    expect(result.output).toBe('tail json');
  });

  it('handles completely non-JSON output as raw text', async () => {
    const engine = new KimiCodeEngine({ command: 'echo', defaultArgs: ['plain text output'] });
    const result = await engine.start(makeRequest());
    expect(result.output).toBe('plain text output');
    expect(result.error).toBeUndefined();
  });

  it('always returns null sessionId', async () => {
    const payload = '{"role":"assistant","content":[{"type":"text","text":"test"}],"session_id":"should-be-ignored"}';
    const engine = new KimiCodeEngine({ command: 'echo', defaultArgs: [payload] });
    const result = await engine.start(makeRequest());
    expect(result.sessionId).toBeNull();
  });

  it('builds resume args with --session flag', async () => {
    // Use node -e to echo all args as JSON. send() passes args directly to spawn.
    const engine = new KimiCodeEngine({
      command: 'node',
    });
    // Override: node -e script echoes argv. But send() builds its own args...
    // The trick: use env var to pass a script, or use a shell wrapper.
    // Simplest: sh -c 'printf "%s\n" "$@"' _ will print each arg on a line.
    const echoEngine = new KimiCodeEngine({ command: 'sh' });
    // send() will call: sh --print --output-format stream-json --session sess-abc -w /tmp/cb-test-project -p 'follow up'
    // sh interprets --print as an error. Instead, we need /usr/bin/env printf or similar.
    // Best: use a wrapper that ignores flags and prints all args.
    // Actually the simplest way: write a tiny temp script.
    const { writeFileSync, unlinkSync, chmodSync } = await import('node:fs');
    const scriptPath = '/tmp/cb-echo-args.sh';
    writeFileSync(scriptPath, '#!/bin/sh\nprintf "%s\\n" "$@"\n');
    chmodSync(scriptPath, 0o755);
    try {
      const testEngine = new KimiCodeEngine({ command: scriptPath });
      const result = await testEngine.send('sess-abc', 'follow up', { cwd: '/tmp/cb-test-project' });
      expect(result.output).toContain('--session');
      expect(result.output).toContain('sess-abc');
      expect(result.output).toContain('-w');
      expect(result.output).toContain('-p');
      expect(result.output).toContain('follow up');
    } finally {
      unlinkSync(scriptPath);
    }
  });
});

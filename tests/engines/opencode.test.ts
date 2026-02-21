import { describe, it, expect, beforeAll } from 'vitest';
import { mkdirSync, writeFileSync, unlinkSync, chmodSync } from 'node:fs';
import { OpenCodeEngine } from '../../src/engines/opencode.js';
import type { TaskRequest } from '../../src/schemas/request.js';

describe('OpenCodeEngine', () => {
  beforeAll(() => {
    mkdirSync('/tmp/cb-test-project', { recursive: true });
  });

  const makeRequest = (overrides?: Partial<TaskRequest>): TaskRequest => ({
    task_id: 'task-001',
    intent: 'coding',
    workspace_path: '/tmp/cb-test-project',
    message: 'Hello world',
    engine: 'opencode',
    mode: 'new',
    session_id: null,
    constraints: { timeout_ms: 30000, allow_network: true },
    ...overrides,
  });

  it('starts a new session and returns pid and output', async () => {
    const engine = new OpenCodeEngine({ command: 'echo', defaultArgs: ['hello from opencode'] });
    const result = await engine.start(makeRequest());
    expect(result.pid).toBeTypeOf('number');
    expect(result.output).toContain('hello from opencode');
    expect(result.error).toBeUndefined();
  });

  it('parses NDJSON text events and extracts output', async () => {
    const lines = [
      '{"type":"text","part":{"text":"Hello "},"sessionID":"sess-abc"}',
      '{"type":"text","part":{"text":"world"},"sessionID":"sess-abc"}',
    ].join('\n');
    const engine = new OpenCodeEngine({ command: 'printf', defaultArgs: ['%s', lines] });
    const result = await engine.start(makeRequest());
    expect(result.output).toBe('Hello world');
    expect(result.sessionId).toBe('sess-abc');
  });

  it('extracts sessionID from events', async () => {
    const line = '{"type":"text","part":{"text":"hi"},"sessionID":"my-session-123"}';
    const engine = new OpenCodeEngine({ command: 'echo', defaultArgs: [line] });
    const result = await engine.start(makeRequest());
    expect(result.sessionId).toBe('my-session-123');
  });

  it('extracts token usage from step_finish event', async () => {
    const scriptPath = '/tmp/cb-opencode-tokens.sh';
    writeFileSync(scriptPath, [
      '#!/bin/sh',
      'echo \'{"type":"text","part":{"text":"done"},"sessionID":"s1"}\'',
      'echo \'{"type":"step_finish","part":{"tokens":{"input":100,"output":50,"total":150}},"sessionID":"s1"}\'',
    ].join('\n'));
    chmodSync(scriptPath, 0o755);
    try {
      const engine = new OpenCodeEngine({ command: scriptPath });
      const result = await engine.start(makeRequest());
      expect(result.tokenUsage).toEqual({
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
      });
    } finally {
      unlinkSync(scriptPath);
    }
  });

  it('uses last step_finish for token usage when multiple exist', async () => {
    const scriptPath = '/tmp/cb-opencode-multi-tokens.sh';
    writeFileSync(scriptPath, [
      '#!/bin/sh',
      'echo \'{"type":"step_finish","part":{"tokens":{"input":10,"output":5,"total":15}},"sessionID":"s1"}\'',
      'echo \'{"type":"text","part":{"text":"result"},"sessionID":"s1"}\'',
      'echo \'{"type":"step_finish","part":{"tokens":{"input":200,"output":100,"total":300}},"sessionID":"s1"}\'',
    ].join('\n'));
    chmodSync(scriptPath, 0o755);
    try {
      const engine = new OpenCodeEngine({ command: scriptPath });
      const result = await engine.start(makeRequest());
      expect(result.tokenUsage).toEqual({
        prompt_tokens: 200,
        completion_tokens: 100,
        total_tokens: 300,
      });
    } finally {
      unlinkSync(scriptPath);
    }
  });

  it('returns null tokenUsage when no step_finish events', async () => {
    const line = '{"type":"text","part":{"text":"no tokens"},"sessionID":"s1"}';
    const engine = new OpenCodeEngine({ command: 'echo', defaultArgs: [line] });
    const result = await engine.start(makeRequest());
    expect(result.tokenUsage).toBeNull();
  });

  it('returns ENGINE_CRASH on non-zero exit code', async () => {
    const engine = new OpenCodeEngine({ command: 'false' });
    const result = await engine.start(makeRequest());
    expect(result.error).toBeDefined();
    expect(result.error?.code).toBe('ENGINE_CRASH');
    expect(result.error?.retryable).toBe(true);
  });

  it('kills process on timeout and returns ENGINE_TIMEOUT', async () => {
    const engine = new OpenCodeEngine({ command: 'sleep', defaultArgs: ['10'] });
    const result = await engine.start(makeRequest({ constraints: { timeout_ms: 500, allow_network: true } }));
    expect(result.error).toBeDefined();
    expect(result.error?.code).toBe('ENGINE_TIMEOUT');
    expect(result.error?.retryable).toBe(true);
  }, 10000);

  it('handles command not found error', async () => {
    const engine = new OpenCodeEngine({ command: 'nonexistent-command-xyz' });
    const result = await engine.start(makeRequest());
    expect(result.error).toBeDefined();
    expect(result.error?.code).toBe('ENGINE_CRASH');
  });

  it('stop() does not throw for non-existent pid', async () => {
    const engine = new OpenCodeEngine();
    await expect(engine.stop(999999)).resolves.not.toThrow();
  });

  it('handles completely non-JSON output as raw text', async () => {
    const engine = new OpenCodeEngine({ command: 'echo', defaultArgs: ['plain text output'] });
    const result = await engine.start(makeRequest());
    expect(result.output).toBe('plain text output');
    expect(result.error).toBeUndefined();
  });

  it('handles empty output gracefully', async () => {
    const engine = new OpenCodeEngine({ command: 'true' });
    const result = await engine.start(makeRequest());
    expect(result.output).toBe('');
    expect(result.error).toBeUndefined();
  });

  it('skips non-JSON log lines in NDJSON output', async () => {
    const scriptPath = '/tmp/cb-opencode-mixed.sh';
    writeFileSync(scriptPath, [
      '#!/bin/sh',
      'echo "WARN: starting up"',
      'echo \'{"type":"text","part":{"text":"actual output"},"sessionID":"s1"}\'',
      'echo "DEBUG: done"',
    ].join('\n'));
    chmodSync(scriptPath, 0o755);
    try {
      const engine = new OpenCodeEngine({ command: scriptPath });
      const result = await engine.start(makeRequest());
      expect(result.output).toBe('actual output');
    } finally {
      unlinkSync(scriptPath);
    }
  });

  it('builds start args with run --format json --dir', async () => {
    const scriptPath = '/tmp/cb-opencode-args.sh';
    writeFileSync(scriptPath, '#!/bin/sh\nprintf "%s\\n" "$@"\n');
    chmodSync(scriptPath, 0o755);
    try {
      const engine = new OpenCodeEngine({ command: scriptPath });
      const result = await engine.start(makeRequest({ workspace_path: '/tmp/cb-test-project', message: 'test prompt' }));
      expect(result.output).toContain('run');
      expect(result.output).toContain('--format');
      expect(result.output).toContain('json');
      expect(result.output).toContain('--dir');
      expect(result.output).toContain('/tmp/cb-test-project');
      expect(result.output).toContain('test prompt');
    } finally {
      unlinkSync(scriptPath);
    }
  });

  it('includes -m flag when model is specified', async () => {
    const scriptPath = '/tmp/cb-opencode-model.sh';
    writeFileSync(scriptPath, '#!/bin/sh\nprintf "%s\\n" "$@"\n');
    chmodSync(scriptPath, 0o755);
    try {
      const engine = new OpenCodeEngine({ command: scriptPath });
      const result = await engine.start(makeRequest({ model: 'pawpaw/claude-sonnet-4-5' }));
      expect(result.output).toContain('-m');
      expect(result.output).toContain('pawpaw/claude-sonnet-4-5');
    } finally {
      unlinkSync(scriptPath);
    }
  });

  it('does not include -m flag when model is not specified', async () => {
    const scriptPath = '/tmp/cb-opencode-no-model.sh';
    writeFileSync(scriptPath, '#!/bin/sh\nprintf "%s\\n" "$@"\n');
    chmodSync(scriptPath, 0o755);
    try {
      const engine = new OpenCodeEngine({ command: scriptPath });
      const result = await engine.start(makeRequest());
      expect(result.output).not.toContain('-m');
    } finally {
      unlinkSync(scriptPath);
    }
  });

  it('send() includes -s flag for session resumption', async () => {
    const scriptPath = '/tmp/cb-opencode-send-args.sh';
    writeFileSync(scriptPath, '#!/bin/sh\nprintf "%s\\n" "$@"\n');
    chmodSync(scriptPath, 0o755);
    try {
      const engine = new OpenCodeEngine({ command: scriptPath });
      const result = await engine.send('sess-abc', 'follow up', { cwd: '/tmp/cb-test-project' });
      expect(result.output).toContain('run');
      expect(result.output).toContain('--format');
      expect(result.output).toContain('-s');
      expect(result.output).toContain('sess-abc');
      expect(result.output).toContain('follow up');
    } finally {
      unlinkSync(scriptPath);
    }
  });

  it('send() parses NDJSON response correctly', async () => {
    const scriptPath = '/tmp/cb-opencode-send-parse.sh';
    writeFileSync(scriptPath, [
      '#!/bin/sh',
      'echo \'{"type":"text","part":{"text":"resumed response"},"sessionID":"sess-abc"}\'',
    ].join('\n'));
    chmodSync(scriptPath, 0o755);
    try {
      const engine = new OpenCodeEngine({ command: scriptPath });
      const result = await engine.send('sess-abc', 'follow up', { cwd: '/tmp/cb-test-project' });
      expect(result.output).toBe('resumed response');
      expect(result.sessionId).toBe('sess-abc');
      expect(result.error).toBeUndefined();
      expect(result.tokenUsage).toBeNull();
    } finally {
      unlinkSync(scriptPath);
    }
  });
});

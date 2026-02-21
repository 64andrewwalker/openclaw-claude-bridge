import { describe, it, expect, beforeAll } from 'vitest';
import { mkdirSync, writeFileSync, unlinkSync, chmodSync } from 'node:fs';
import { CodexEngine } from '../../src/engines/codex.js';
import type { TaskRequest } from '../../src/schemas/request.js';

describe('CodexEngine', () => {
  beforeAll(() => {
    mkdirSync('/tmp/cb-test-project', { recursive: true });
  });

  const makeRequest = (overrides?: Partial<TaskRequest>): TaskRequest => ({
    task_id: 'task-001',
    intent: 'coding',
    workspace_path: '/tmp/cb-test-project',
    message: 'Hello world',
    engine: 'codex',
    mode: 'new',
    session_id: null,
    constraints: { timeout_ms: 30000, allow_network: true },
    ...overrides,
  });

  it('starts a new session and returns pid and output', async () => {
    const engine = new CodexEngine({ command: 'echo', defaultArgs: ['hello from codex'] });
    const result = await engine.start(makeRequest());
    expect(result.pid).toBeTypeOf('number');
    expect(result.output).toContain('hello from codex');
    expect(result.error).toBeUndefined();
  });

  it('extracts session ID from thread.started event', async () => {
    const scriptPath = '/tmp/cb-codex-thread.sh';
    writeFileSync(scriptPath, [
      '#!/bin/sh',
      'echo \'{"type":"thread.started","thread":{"id":"thread-123"}}\'',
      'echo \'{"type":"message.completed","message":{"content":[{"type":"text","text":"done"}]}}\'',
    ].join('\n'));
    chmodSync(scriptPath, 0o755);
    try {
      const engine = new CodexEngine({ command: scriptPath });
      const result = await engine.start(makeRequest());
      expect(result.sessionId).toBe('thread-123');
      expect(result.output).toBe('done');
    } finally {
      unlinkSync(scriptPath);
    }
  });

  it('extracts text from message.completed events', async () => {
    const scriptPath = '/tmp/cb-codex-message.sh';
    writeFileSync(scriptPath, [
      '#!/bin/sh',
      'echo \'{"type":"message.completed","message":{"content":[{"type":"text","text":"Hello "},{"type":"text","text":"world"}]}}\'',
    ].join('\n'));
    chmodSync(scriptPath, 0o755);
    try {
      const engine = new CodexEngine({ command: scriptPath });
      const result = await engine.start(makeRequest());
      expect(result.output).toBe('Hello world');
    } finally {
      unlinkSync(scriptPath);
    }
  });

  it('extracts text from response.completed events', async () => {
    const scriptPath = '/tmp/cb-codex-response.sh';
    writeFileSync(scriptPath, [
      '#!/bin/sh',
      'echo \'{"type":"response.completed","response":{"content":[{"type":"text","text":"response text"}]}}\'',
    ].join('\n'));
    chmodSync(scriptPath, 0o755);
    try {
      const engine = new CodexEngine({ command: scriptPath });
      const result = await engine.start(makeRequest());
      expect(result.output).toBe('response text');
    } finally {
      unlinkSync(scriptPath);
    }
  });

  it('extracts text from output_text shorthand', async () => {
    const scriptPath = '/tmp/cb-codex-output-text.sh';
    writeFileSync(scriptPath, [
      '#!/bin/sh',
      'echo \'{"type":"message.completed","message":{"output_text":"shorthand result"}}\'',
    ].join('\n'));
    chmodSync(scriptPath, 0o755);
    try {
      const engine = new CodexEngine({ command: scriptPath });
      const result = await engine.start(makeRequest());
      expect(result.output).toBe('shorthand result');
    } finally {
      unlinkSync(scriptPath);
    }
  });

  it('extracts text from item.completed events', async () => {
    const scriptPath = '/tmp/cb-codex-item.sh';
    writeFileSync(scriptPath, [
      '#!/bin/sh',
      'echo \'{"type":"item.completed","item":{"type":"message","content":[{"type":"output_text","text":"item text"}]}}\'',
    ].join('\n'));
    chmodSync(scriptPath, 0o755);
    try {
      const engine = new CodexEngine({ command: scriptPath });
      const result = await engine.start(makeRequest());
      expect(result.output).toBe('item text');
    } finally {
      unlinkSync(scriptPath);
    }
  });

  it('always returns null tokenUsage', async () => {
    const engine = new CodexEngine({ command: 'echo', defaultArgs: ['test'] });
    const result = await engine.start(makeRequest());
    expect(result.tokenUsage).toBeNull();
  });

  it('returns ENGINE_CRASH on non-zero exit code', async () => {
    const engine = new CodexEngine({ command: 'false' });
    const result = await engine.start(makeRequest());
    expect(result.error).toBeDefined();
    expect(result.error?.code).toBe('ENGINE_CRASH');
    expect(result.error?.retryable).toBe(true);
  });

  it('kills process on timeout and returns ENGINE_TIMEOUT', async () => {
    const engine = new CodexEngine({ command: 'sleep', defaultArgs: ['10'] });
    const result = await engine.start(makeRequest({ constraints: { timeout_ms: 500, allow_network: true } }));
    expect(result.error).toBeDefined();
    expect(result.error?.code).toBe('ENGINE_TIMEOUT');
    expect(result.error?.retryable).toBe(true);
  }, 10000);

  it('handles command not found error', async () => {
    const engine = new CodexEngine({ command: 'nonexistent-command-xyz' });
    const result = await engine.start(makeRequest());
    expect(result.error).toBeDefined();
    expect(result.error?.code).toBe('ENGINE_CRASH');
  });

  it('stop() does not throw for non-existent pid', async () => {
    const engine = new CodexEngine();
    await expect(engine.stop(999999)).resolves.not.toThrow();
  });

  it('handles completely non-JSON output as raw text', async () => {
    const engine = new CodexEngine({ command: 'echo', defaultArgs: ['plain text output'] });
    const result = await engine.start(makeRequest());
    expect(result.output).toBe('plain text output');
    expect(result.error).toBeUndefined();
  });

  it('handles empty output gracefully', async () => {
    const engine = new CodexEngine({ command: 'true' });
    const result = await engine.start(makeRequest());
    expect(result.output).toBe('');
    expect(result.error).toBeUndefined();
  });

  it('skips non-JSON log lines in JSONL output', async () => {
    const scriptPath = '/tmp/cb-codex-mixed.sh';
    writeFileSync(scriptPath, [
      '#!/bin/sh',
      'echo "WARN: starting up"',
      'echo \'{"type":"message.completed","message":{"content":[{"type":"text","text":"actual output"}]}}\'',
      'echo "DEBUG: done"',
    ].join('\n'));
    chmodSync(scriptPath, 0o755);
    try {
      const engine = new CodexEngine({ command: scriptPath });
      const result = await engine.start(makeRequest());
      expect(result.output).toBe('actual output');
    } finally {
      unlinkSync(scriptPath);
    }
  });

  it('builds start args with exec --json --full-auto -C', async () => {
    const scriptPath = '/tmp/cb-codex-args.sh';
    writeFileSync(scriptPath, '#!/bin/sh\nprintf "%s\\n" "$@"\n');
    chmodSync(scriptPath, 0o755);
    try {
      const engine = new CodexEngine({ command: scriptPath });
      const result = await engine.start(makeRequest({ workspace_path: '/tmp/cb-test-project', message: 'test prompt' }));
      expect(result.output).toContain('exec');
      expect(result.output).toContain('--json');
      expect(result.output).toContain('--full-auto');
      expect(result.output).toContain('-C');
      expect(result.output).toContain('/tmp/cb-test-project');
      expect(result.output).toContain('test prompt');
    } finally {
      unlinkSync(scriptPath);
    }
  });

  it('includes -m flag when model is specified', async () => {
    const scriptPath = '/tmp/cb-codex-model.sh';
    writeFileSync(scriptPath, '#!/bin/sh\nprintf "%s\\n" "$@"\n');
    chmodSync(scriptPath, 0o755);
    try {
      const engine = new CodexEngine({ command: scriptPath });
      const result = await engine.start(makeRequest({ model: 'gpt-5.3-codex' }));
      expect(result.output).toContain('-m');
      expect(result.output).toContain('gpt-5.3-codex');
    } finally {
      unlinkSync(scriptPath);
    }
  });

  it('does not include -m flag when model is not specified', async () => {
    const scriptPath = '/tmp/cb-codex-no-model.sh';
    writeFileSync(scriptPath, '#!/bin/sh\nprintf "%s\\n" "$@"\n');
    chmodSync(scriptPath, 0o755);
    try {
      const engine = new CodexEngine({ command: scriptPath });
      const result = await engine.start(makeRequest());
      expect(result.output).not.toContain('-m');
    } finally {
      unlinkSync(scriptPath);
    }
  });

  it('send() includes resume and session ID for resumption', async () => {
    const scriptPath = '/tmp/cb-codex-send-args.sh';
    writeFileSync(scriptPath, '#!/bin/sh\nprintf "%s\\n" "$@"\n');
    chmodSync(scriptPath, 0o755);
    try {
      const engine = new CodexEngine({ command: scriptPath });
      const result = await engine.send('thread-abc', 'follow up', { cwd: '/tmp/cb-test-project' });
      expect(result.output).toContain('exec');
      expect(result.output).toContain('--json');
      expect(result.output).toContain('resume');
      expect(result.output).toContain('thread-abc');
      expect(result.output).toContain('follow up');
    } finally {
      unlinkSync(scriptPath);
    }
  });

  it('send() parses JSONL response correctly', async () => {
    const scriptPath = '/tmp/cb-codex-send-parse.sh';
    writeFileSync(scriptPath, [
      '#!/bin/sh',
      'echo \'{"type":"message.completed","message":{"content":[{"type":"text","text":"resumed response"}]}}\'',
    ].join('\n'));
    chmodSync(scriptPath, 0o755);
    try {
      const engine = new CodexEngine({ command: scriptPath });
      const result = await engine.send('thread-abc', 'follow up', { cwd: '/tmp/cb-test-project' });
      expect(result.output).toBe('resumed response');
      expect(result.error).toBeUndefined();
    } finally {
      unlinkSync(scriptPath);
    }
  });
});

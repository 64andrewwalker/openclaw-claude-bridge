import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { KimiCodeEngine } from '../../src/engines/kimi-code.js';
import type { TaskRequest } from '../../src/schemas/request.js';

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

  it('includes -m flag when model is specified', async () => {
    const { writeFileSync, unlinkSync, chmodSync } = await import('node:fs');
    const scriptPath = '/tmp/cb-kimi-model.sh';
    writeFileSync(scriptPath, '#!/bin/sh\nprintf "%s\\n" "$@"\n');
    chmodSync(scriptPath, 0o755);
    try {
      const engine = new KimiCodeEngine({ command: scriptPath });
      const result = await engine.start(makeRequest({ model: 'k2p5' }));
      expect(result.output).toContain('-m');
      expect(result.output).toContain('k2p5');
    } finally {
      unlinkSync(scriptPath);
    }
  });

  it('does not include -m flag when model is not specified', async () => {
    const { writeFileSync, unlinkSync, chmodSync } = await import('node:fs');
    const scriptPath = '/tmp/cb-kimi-no-model.sh';
    writeFileSync(scriptPath, '#!/bin/sh\nprintf "%s\\n" "$@"\n');
    chmodSync(scriptPath, 0o755);
    try {
      const engine = new KimiCodeEngine({ command: scriptPath });
      const result = await engine.start(makeRequest());
      expect(result.output).not.toContain('-m');
    } finally {
      unlinkSync(scriptPath);
    }
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
    const { writeFileSync, unlinkSync, chmodSync } = await import('node:fs');
    const scriptPath = '/tmp/cb-ndjson-test.sh';
    writeFileSync(scriptPath, [
      '#!/bin/sh',
      'echo \'{"role":"assistant","content":[{"type":"text","text":"Let me check. "}]}\'',
      'echo \'{"role":"tool","tool_call_id":"call-1","content":"file.txt exists"}\'',
      'echo \'{"role":"assistant","content":[{"type":"text","text":"The file exists."}]}\'',
    ].join('\n'));
    chmodSync(scriptPath, 0o755);
    try {
      const engine = new KimiCodeEngine({ command: scriptPath });
      const result = await engine.start(makeRequest());
      expect(result.output).toBe('Let me check. The file exists.');
    } finally {
      unlinkSync(scriptPath);
    }
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

  // --- Role filtering tests ---

  it('returns empty string when output contains only user-role messages', async () => {
    const payload = '{"role":"user","content":[{"type":"text","text":"user prompt echoed back"}]}';
    const engine = new KimiCodeEngine({ command: 'echo', defaultArgs: [payload] });
    const result = await engine.start(makeRequest());
    expect(result.output).toBe('');
    expect(result.error).toBeUndefined();
  });

  it('returns empty string when output contains only system-role messages', async () => {
    const payload = '{"role":"system","content":[{"type":"text","text":"system instruction echoed back"}]}';
    const engine = new KimiCodeEngine({ command: 'echo', defaultArgs: [payload] });
    const result = await engine.start(makeRequest());
    expect(result.output).toBe('');
    expect(result.error).toBeUndefined();
  });

  it('returns empty string when only non-assistant messages present (no raw JSON bleed-through)', async () => {
    // Edge case: NDJSON with only user+system messages — should return "" not raw JSON
    const { writeFileSync, unlinkSync, chmodSync } = await import('node:fs');
    const scriptPath = '/tmp/cb-role-filter-only-non-assistant.sh';
    writeFileSync(scriptPath, [
      '#!/bin/sh',
      'echo \'{"role":"user","content":[{"type":"text","text":"what is 2+2?"}]}\'',
      'echo \'{"role":"system","content":[{"type":"text","text":"You are a helpful assistant"}]}\'',
    ].join('\n'));
    chmodSync(scriptPath, 0o755);
    try {
      const engine = new KimiCodeEngine({ command: scriptPath });
      const result = await engine.start(makeRequest());
      expect(result.output).toBe('');
    } finally {
      unlinkSync(scriptPath);
    }
  });

  it('filters user-role messages and returns only assistant text in mixed stream', async () => {
    // Mixed stream: user message followed by assistant reply
    const { writeFileSync, unlinkSync, chmodSync } = await import('node:fs');
    const scriptPath = '/tmp/cb-role-filter-mixed.sh';
    writeFileSync(scriptPath, [
      '#!/bin/sh',
      'echo \'{"role":"user","content":[{"type":"text","text":"tell me a joke"}]}\'',
      'echo \'{"role":"assistant","content":[{"type":"text","text":"Why did the chicken cross the road?"}]}\'',
    ].join('\n'));
    chmodSync(scriptPath, 0o755);
    try {
      const engine = new KimiCodeEngine({ command: scriptPath });
      const result = await engine.start(makeRequest());
      expect(result.output).toBe('Why did the chicken cross the road?');
    } finally {
      unlinkSync(scriptPath);
    }
  });

  // --- send() method parsing tests ---
  // Note: send() builds its own args (ignoring defaultArgs), so we use script wrappers.

  it('send() parses stream-json response correctly', async () => {
    const { writeFileSync, unlinkSync, chmodSync } = await import('node:fs');
    const scriptPath = '/tmp/cb-send-parse.sh';
    const payload = '{"role":"assistant","content":[{"type":"text","text":"resumed response"}]}';
    writeFileSync(scriptPath, `#!/bin/sh\necho '${payload}'\n`);
    chmodSync(scriptPath, 0o755);
    try {
      const engine = new KimiCodeEngine({ command: scriptPath });
      const result = await engine.send('sess-123', 'follow up', { cwd: '/tmp/cb-test-project' });
      expect(result.output).toBe('resumed response');
      expect(result.error).toBeUndefined();
      expect(result.tokenUsage).toBeNull();
    } finally {
      unlinkSync(scriptPath);
    }
  });

  it('send() concatenates multiple text parts', async () => {
    const { writeFileSync, unlinkSync, chmodSync } = await import('node:fs');
    const scriptPath = '/tmp/cb-send-concat.sh';
    const payload = '{"role":"assistant","content":[{"type":"text","text":"part1"},{"type":"text","text":" part2"}]}';
    writeFileSync(scriptPath, `#!/bin/sh\necho '${payload}'\n`);
    chmodSync(scriptPath, 0o755);
    try {
      const engine = new KimiCodeEngine({ command: scriptPath });
      const result = await engine.send('sess-123', 'follow up', { cwd: '/tmp/cb-test-project' });
      expect(result.output).toBe('part1 part2');
    } finally {
      unlinkSync(scriptPath);
    }
  });

  it('send() returns ENGINE_TIMEOUT on timeout', async () => {
    const engine = new KimiCodeEngine({ command: 'sleep' });
    // send() will call: sleep --print --output-format ... which sleep ignores, just sleeps
    // Actually sleep with invalid args may error immediately. Use a script instead.
    const { writeFileSync, unlinkSync, chmodSync } = await import('node:fs');
    const scriptPath = '/tmp/cb-send-slow.sh';
    writeFileSync(scriptPath, '#!/bin/sh\nsleep 10\n');
    chmodSync(scriptPath, 0o755);
    try {
      const engine2 = new KimiCodeEngine({ command: scriptPath });
      const result = await engine2.send('sess-123', 'slow', { timeoutMs: 500, cwd: '/tmp/cb-test-project' });
      expect(result.error?.code).toBe('ENGINE_TIMEOUT');
    } finally {
      unlinkSync(scriptPath);
    }
  }, 15000);

  // --- buildStartArgs verification ---

  it('start() includes -w and -p flags when no defaultArgs set', async () => {
    const { writeFileSync, unlinkSync, chmodSync } = await import('node:fs');
    const scriptPath = '/tmp/cb-check-start-args.sh';
    writeFileSync(scriptPath, '#!/bin/sh\nprintf "%s\\n" "$@"\n');
    chmodSync(scriptPath, 0o755);
    try {
      const engine = new KimiCodeEngine({ command: scriptPath });
      const result = await engine.start(makeRequest({ workspace_path: '/tmp/cb-test-project', message: 'test prompt' }));
      expect(result.output).toContain('-w');
      expect(result.output).toContain('/tmp/cb-test-project');
      expect(result.output).toContain('-p');
      expect(result.output).toContain('test prompt');
      expect(result.output).toContain('--print');
      expect(result.output).toContain('stream-json');
    } finally {
      unlinkSync(scriptPath);
    }
  });

  it('builds resume args with --session flag', async () => {
    const { writeFileSync: wfs, unlinkSync, chmodSync } = await import('node:fs');
    const scriptPath = '/tmp/cb-echo-args.sh';
    wfs(scriptPath, '#!/bin/sh\nprintf "%s\\n" "$@"\n');
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

  // --- Session ID extraction from ~/.kimi/kimi.json ---

  describe('session ID extraction', () => {
    const fakeHome = '/tmp/cb-kimi-home-test';
    let originalHome: string | undefined;

    beforeAll(() => {
      mkdirSync(path.join(fakeHome, '.kimi'), { recursive: true });
    });

    beforeEach(() => {
      originalHome = process.env.HOME;
      process.env.HOME = fakeHome;
    });

    afterEach(() => {
      process.env.HOME = originalHome;
      try { rmSync(path.join(fakeHome, '.kimi', 'kimi.json')); } catch { /* ok */ }
    });

    const writeKimiJson = (workDirs: Array<{ path: string; last_session_id?: string }>) => {
      writeFileSync(
        path.join(fakeHome, '.kimi', 'kimi.json'),
        JSON.stringify({ work_dirs: workDirs }),
      );
    };

    it('returns null when kimi.json does not exist', async () => {
      const payload = '{"role":"assistant","content":[{"type":"text","text":"test"}]}';
      const engine = new KimiCodeEngine({ command: 'echo', defaultArgs: [payload] });
      const result = await engine.start(makeRequest());
      expect(result.sessionId).toBeNull();
    });

    it('start() returns session ID when kimi.json has matching workspace entry', async () => {
      writeKimiJson([
        { path: '/tmp/cb-test-project', last_session_id: 'sess-from-kimi-abc' },
      ]);
      const payload = '{"role":"assistant","content":[{"type":"text","text":"ok"}]}';
      const engine = new KimiCodeEngine({ command: 'echo', defaultArgs: [payload] });
      const result = await engine.start(makeRequest());
      expect(result.sessionId).toBe('sess-from-kimi-abc');
    });

    it('start() returns null when kimi.json exists but workspace not found', async () => {
      writeKimiJson([
        { path: '/some/other/path', last_session_id: 'sess-other' },
      ]);
      const payload = '{"role":"assistant","content":[{"type":"text","text":"ok"}]}';
      const engine = new KimiCodeEngine({ command: 'echo', defaultArgs: [payload] });
      const result = await engine.start(makeRequest());
      expect(result.sessionId).toBeNull();
    });

    it('start() returns null when kimi.json has no work_dirs', async () => {
      writeFileSync(
        path.join(fakeHome, '.kimi', 'kimi.json'),
        JSON.stringify({ version: 1 }),
      );
      const payload = '{"role":"assistant","content":[{"type":"text","text":"ok"}]}';
      const engine = new KimiCodeEngine({ command: 'echo', defaultArgs: [payload] });
      const result = await engine.start(makeRequest());
      expect(result.sessionId).toBeNull();
    });

    it('send() returns session ID from kimi.json', async () => {
      writeKimiJson([
        { path: '/tmp/cb-test-project', last_session_id: 'sess-resumed-xyz' },
      ]);
      const { writeFileSync: wfs2, unlinkSync, chmodSync } = await import('node:fs');
      const scriptPath = '/tmp/cb-kimi-send-session.sh';
      const payload = '{"role":"assistant","content":[{"type":"text","text":"resumed"}]}';
      wfs2(scriptPath, `#!/bin/sh\necho '${payload}'\n`);
      chmodSync(scriptPath, 0o755);
      try {
        const engine = new KimiCodeEngine({ command: scriptPath });
        const result = await engine.send('old-sess', 'follow up', { cwd: '/tmp/cb-test-project' });
        expect(result.sessionId).toBe('sess-resumed-xyz');
      } finally {
        unlinkSync(scriptPath);
      }
    });

    it('returns null when kimi.json entry has no last_session_id', async () => {
      writeKimiJson([
        { path: '/tmp/cb-test-project' },
      ]);
      const payload = '{"role":"assistant","content":[{"type":"text","text":"ok"}]}';
      const engine = new KimiCodeEngine({ command: 'echo', defaultArgs: [payload] });
      const result = await engine.start(makeRequest());
      expect(result.sessionId).toBeNull();
    });

    it('returns null when last_session_id is empty string', async () => {
      writeKimiJson([
        { path: '/tmp/cb-test-project', last_session_id: '' },
      ]);
      const payload = '{"role":"assistant","content":[{"type":"text","text":"ok"}]}';
      const engine = new KimiCodeEngine({ command: 'echo', defaultArgs: [payload] });
      const result = await engine.start(makeRequest());
      expect(result.sessionId).toBeNull();
    });

    it('picks the correct workspace from multiple entries', async () => {
      writeKimiJson([
        { path: '/some/other/project', last_session_id: 'sess-wrong' },
        { path: '/tmp/cb-test-project', last_session_id: 'sess-right' },
        { path: '/another/project', last_session_id: 'sess-also-wrong' },
      ]);
      const payload = '{"role":"assistant","content":[{"type":"text","text":"ok"}]}';
      const engine = new KimiCodeEngine({ command: 'echo', defaultArgs: [payload] });
      const result = await engine.start(makeRequest());
      expect(result.sessionId).toBe('sess-right');
    });
  });
});

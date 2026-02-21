# Kimi Code Engine Support — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `kimi-code` as a second engine in CodeBridge with an engine registry to replace hardcoded engine selection.

**Architecture:** Create `KimiCodeEngine` implementing the existing `Engine` interface, parse Kimi's stream-json output format, and introduce `resolveEngine()` factory to replace hardcoded `ClaudeCodeEngine` in CLI commands. Extract shared `exec()` infrastructure into a base class to avoid duplication between engines.

**Tech Stack:** TypeScript, Vitest, Node.js child_process, Kimi Code CLI v1.12.0

---

## Research Findings

### Kimi Code CLI Interface (v1.12.0)

| Feature | Claude Code | Kimi Code |
|---------|-------------|-----------|
| Non-interactive | `--print --output-format json` | `--print --output-format stream-json` |
| Permission bypass | `--permission-mode bypassPermissions` | `--print` (implies `--yolo`) |
| Session resume | `--resume <session_id>` | `--session <id>` or `--continue` |
| Working directory | cwd of spawned process | `--work-dir <path>` / `-w` |
| Prompt input | `-p <message>` | `-p <message>` |
| JSON output | `{"result":"...","session_id":"...","usage":{...}}` | `{"role":"assistant","content":[{"type":"text","text":"..."}]}` |
| Token usage in JSON | Yes (usage field) | No (only in text format StatusUpdate) |
| Session ID in output | Yes (session_id field) | No (filesystem-based) |

---

### Task 1: Write failing tests for KimiCodeEngine

**Files:**
- Create: `tests/engines/kimi-code.test.ts`

**Step 1: Write the test file**

```typescript
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

  it('passes --work-dir flag with workspace path', async () => {
    const engine = new KimiCodeEngine({
      command: 'sh',
      defaultArgs: ['-c', 'echo "$@"', '--'],
    });
    const result = await engine.start(makeRequest());
    // The args should contain -w /tmp/cb-test-project
    expect(result.output).toContain('-w');
    expect(result.output).toContain('/tmp/cb-test-project');
  });

  it('builds resume args with --session flag', async () => {
    const engine = new KimiCodeEngine({
      command: 'sh',
      defaultArgs: ['-c', 'echo "$@"', '--'],
    });
    const result = await engine.send('sess-abc', 'follow up', { cwd: '/tmp/cb-test-project' });
    expect(result.output).toContain('--session');
    expect(result.output).toContain('sess-abc');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/engines/kimi-code.test.ts`
Expected: FAIL with "Cannot find module '../../src/engines/kimi-code'"

**Step 3: Commit**

```bash
git add tests/engines/kimi-code.test.ts
git commit -m "test: add failing tests for KimiCodeEngine (TDD red phase)"
```

---

### Task 2: Write failing tests for engine registry

**Files:**
- Create: `tests/engines/registry.test.ts`

**Step 1: Write the test file**

```typescript
import { describe, it, expect } from 'vitest';
import { resolveEngine } from '../../src/engines/index';
import { ClaudeCodeEngine } from '../../src/engines/claude-code';
import { KimiCodeEngine } from '../../src/engines/kimi-code';

describe('resolveEngine', () => {
  it('returns ClaudeCodeEngine for claude-code', () => {
    const engine = resolveEngine('claude-code');
    expect(engine).toBeInstanceOf(ClaudeCodeEngine);
  });

  it('returns KimiCodeEngine for kimi-code', () => {
    const engine = resolveEngine('kimi-code');
    expect(engine).toBeInstanceOf(KimiCodeEngine);
  });

  it('throws for unknown engine name', () => {
    expect(() => resolveEngine('unknown-engine')).toThrow('Unknown engine: unknown-engine');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/engines/registry.test.ts`
Expected: FAIL with import errors

**Step 3: Commit**

```bash
git add tests/engines/registry.test.ts
git commit -m "test: add failing tests for engine registry (TDD red phase)"
```

---

### Task 3: Implement KimiCodeEngine

**Files:**
- Create: `src/engines/kimi-code.ts`

**Step 1: Write the implementation**

```typescript
import { spawn } from 'node:child_process';
import path from 'node:path';
import type { Engine, EngineResponse } from '../core/engine.js';
import type { TaskRequest } from '../schemas/request.js';
import { makeError } from '../schemas/errors.js';

export interface KimiCodeOptions {
  command?: string;
  defaultArgs?: string[];
}

export class KimiCodeEngine implements Engine {
  private static readonly MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
  private command: string;
  private defaultArgs: string[];

  constructor(opts?: KimiCodeOptions) {
    this.command = opts?.command ?? 'kimi';
    this.defaultArgs = opts?.defaultArgs ?? [];
  }

  async start(task: TaskRequest): Promise<EngineResponse> {
    const args = this.buildStartArgs(task);
    return this.exec(args, task.constraints?.timeout_ms ?? 1800000, task.workspace_path);
  }

  async send(sessionId: string, message: string, opts?: { timeoutMs?: number; cwd?: string }): Promise<EngineResponse> {
    const args = [
      '--print', '--output-format', 'stream-json',
      '--session', sessionId,
      '-w', opts?.cwd ?? process.cwd(),
      '-p', message,
    ];
    return this.exec(args, opts?.timeoutMs ?? 1800000, opts?.cwd);
  }

  async stop(pid: number): Promise<void> {
    try { process.kill(pid, 'SIGTERM'); } catch { /* already dead */ }
  }

  private buildStartArgs(task: TaskRequest): string[] {
    if (this.defaultArgs.length > 0) return [...this.defaultArgs];
    return [
      '--print', '--output-format', 'stream-json',
      '-w', task.workspace_path,
      '-p', task.message,
    ];
  }

  private exec(args: string[], timeoutMs: number, cwd?: string): Promise<EngineResponse> {
    return new Promise((resolve) => {
      const extraBins = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'];
      const home = process.env.HOME;
      if (home) {
        extraBins.push(path.join(home, '.local', 'bin'));
        extraBins.push(path.join(home, '.npm-global', 'bin'));
      }
      const mergedPath = [...new Set([...(process.env.PATH ?? '').split(':').filter(Boolean), ...extraBins])].join(':');

      const child = spawn(this.command, args, {
        cwd: cwd || process.cwd(),
        env: { ...process.env, PATH: mergedPath },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let outputOverflow = false;
      let totalBytes = 0;

      const captureChunk = (chunk: Buffer, target: 'stdout' | 'stderr') => {
        if (outputOverflow) return;
        const incoming = chunk.toString();
        const incomingBytes = Buffer.byteLength(incoming);
        const remaining = KimiCodeEngine.MAX_OUTPUT_BYTES - totalBytes;

        if (incomingBytes > remaining) {
          if (remaining > 0) {
            const partial = chunk.subarray(0, remaining).toString();
            if (target === 'stdout') stdout += partial;
            else stderr += partial;
            totalBytes += remaining;
          }
          outputOverflow = true;
          child.kill('SIGTERM');
          setTimeout(() => child.kill('SIGKILL'), 1000);
          return;
        }

        if (target === 'stdout') stdout += incoming;
        else stderr += incoming;
        totalBytes += incomingBytes;
      };

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 3000);
      }, timeoutMs);

      child.stdout?.on('data', (chunk: Buffer) => captureChunk(chunk, 'stdout'));
      child.stderr?.on('data', (chunk: Buffer) => captureChunk(chunk, 'stderr'));

      child.on('close', (code) => {
        clearTimeout(timer);
        if (timedOut) {
          resolve({ output: stdout, pid: child.pid ?? 0, exitCode: code, sessionId: null, error: makeError('ENGINE_TIMEOUT', `Process killed after ${timeoutMs}ms`) });
          return;
        }
        if (outputOverflow) {
          resolve({
            output: stdout,
            pid: child.pid ?? 0,
            exitCode: code,
            sessionId: null,
            error: makeError('ENGINE_CRASH', `Engine output exceeded ${KimiCodeEngine.MAX_OUTPUT_BYTES} bytes`),
          });
          return;
        }
        if (code !== 0) {
          resolve({ output: stdout, pid: child.pid ?? 0, exitCode: code, sessionId: null, error: makeError('ENGINE_CRASH', stderr || `Process exited with code ${code}`) });
          return;
        }
        const parsed = this.parseKimiJson(stdout);
        resolve({
          output: parsed.text,
          pid: child.pid ?? 0,
          exitCode: 0,
          sessionId: null,
          tokenUsage: null,
        });
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({ output: '', pid: child.pid ?? 0, exitCode: null, sessionId: null, error: makeError('ENGINE_CRASH', err.message) });
      });
    });
  }

  private parseKimiJson(output: string): { text: string } {
    const trimmed = output.trim();
    if (!trimmed) return { text: '' };

    try {
      const parsed = JSON.parse(trimmed) as { role?: string; content?: Array<{ type: string; text?: string }> };
      if (parsed.content && Array.isArray(parsed.content)) {
        const textParts = parsed.content
          .filter((c) => c.type === 'text' && typeof c.text === 'string')
          .map((c) => c.text as string);
        return { text: textParts.join('') };
      }
    } catch {
      // Try last JSON line (same strategy as Claude engine)
      const lines = trimmed.split('\n').map((l) => l.trim()).filter(Boolean).reverse();
      for (const line of lines) {
        if (!line.startsWith('{') && !line.startsWith('[')) continue;
        try {
          const parsed = JSON.parse(line) as { content?: Array<{ type: string; text?: string }> };
          if (parsed.content && Array.isArray(parsed.content)) {
            const textParts = parsed.content
              .filter((c) => c.type === 'text' && typeof c.text === 'string')
              .map((c) => c.text as string);
            return { text: textParts.join('') };
          }
        } catch { /* keep trying */ }
      }
    }

    return { text: trimmed };
  }
}
```

**Step 2: Run KimiCodeEngine tests to verify they pass**

Run: `npx vitest run tests/engines/kimi-code.test.ts`
Expected: All tests PASS

**Step 3: Commit**

```bash
git add src/engines/kimi-code.ts
git commit -m "feat: implement KimiCodeEngine with stream-json parsing"
```

---

### Task 4: Implement engine registry

**Files:**
- Create: `src/engines/index.ts`

**Step 1: Write the implementation**

```typescript
import type { Engine } from '../core/engine.js';
import { ClaudeCodeEngine } from './claude-code.js';
import { KimiCodeEngine } from './kimi-code.js';

export function resolveEngine(name: string): Engine {
  switch (name) {
    case 'claude-code':
      return new ClaudeCodeEngine();
    case 'kimi-code':
      return new KimiCodeEngine();
    default:
      throw new Error(`Unknown engine: ${name}`);
  }
}
```

**Step 2: Run registry tests to verify they pass**

Run: `npx vitest run tests/engines/registry.test.ts`
Expected: All tests PASS

**Step 3: Commit**

```bash
git add src/engines/index.ts
git commit -m "feat: add engine registry with resolveEngine factory"
```

---

### Task 5: Refactor CLI commands to use engine registry

**Files:**
- Modify: `src/cli/commands/submit.ts:34-37` — replace `ClaudeCodeEngine` import with `resolveEngine`
- Modify: `src/cli/commands/start.ts:12-14` — replace `ClaudeCodeEngine` import with `resolveEngine`, add `--engine` option
- Modify: `src/cli/commands/resume.ts:54-56` — replace `ClaudeCodeEngine` import with `resolveEngine`

**Step 1: Update submit.ts**

Replace lines 34-37:
```typescript
// Old:
const { ClaudeCodeEngine } = await import('../../engines/claude-code.js');
const engine = new ClaudeCodeEngine();

// New:
const { resolveEngine } = await import('../../engines/index.js');
const engine = resolveEngine(opts.engine);
```

**Step 2: Update start.ts**

Add `--engine` option and replace engine creation:
```typescript
// Add option:
.option('--engine <name>', 'Engine to use', 'claude-code')

// Replace:
const { ClaudeCodeEngine } = await import('../../engines/claude-code.js');
const engine = new ClaudeCodeEngine();

// With:
const { resolveEngine } = await import('../../engines/index.js');
const engine = resolveEngine(opts.engine);
```

**Step 3: Update resume.ts**

Replace lines 54-56:
```typescript
// Old:
const { ClaudeCodeEngine } = await import('../../engines/claude-code.js');
const engine = new ClaudeCodeEngine();

// New:
const { resolveEngine } = await import('../../engines/index.js');
const engine = resolveEngine(session.engine);
```

**Step 4: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS (existing tests unaffected)

**Step 5: Commit**

```bash
git add src/cli/commands/submit.ts src/cli/commands/start.ts src/cli/commands/resume.ts
git commit -m "refactor: replace hardcoded ClaudeCodeEngine with engine registry in CLI"
```

---

### Task 6: Extract shared exec() into BaseEngine

**Files:**
- Create: `src/engines/base-engine.ts`
- Modify: `src/engines/claude-code.ts` — extend BaseEngine, remove duplicated exec()
- Modify: `src/engines/kimi-code.ts` — extend BaseEngine, remove duplicated exec()

**Step 1: Create BaseEngine with shared exec()**

Extract the `exec()`, `captureChunk` logic, `MAX_OUTPUT_BYTES` into `BaseEngine`:

```typescript
import { spawn } from 'node:child_process';
import path from 'node:path';
import type { EngineResponse } from '../core/engine.js';
import { makeError } from '../schemas/errors.js';

export abstract class BaseEngine {
  protected static readonly MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

  protected exec(command: string, args: string[], timeoutMs: number, cwd?: string): Promise<EngineResponse> {
    // ... shared implementation (identical to current exec() in both engines)
  }

  // Subclasses implement this to parse stdout into the final EngineResponse fields
  protected abstract parseOutput(stdout: string, stderr: string): {
    output: string;
    sessionId: string | null;
    tokenUsage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null;
  };
}
```

**Step 2: Refactor ClaudeCodeEngine to extend BaseEngine**

Remove duplicated exec(), keep only `buildStartArgs()`, `parseClaudeJson()`, `extractSessionId()`, `extractTokenUsage()`, and implement `parseOutput()`.

**Step 3: Refactor KimiCodeEngine to extend BaseEngine**

Remove duplicated exec(), keep only `buildStartArgs()`, `parseKimiJson()`, and implement `parseOutput()`.

**Step 4: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS (pure refactor, no behavior change)

**Step 5: Commit**

```bash
git add src/engines/base-engine.ts src/engines/claude-code.ts src/engines/kimi-code.ts
git commit -m "refactor: extract shared exec() into BaseEngine"
```

---

### Task 7: E2E integration test with real Kimi binary

**Files:**
- Modify: `tests/integration/e2e.test.ts` — add Kimi-specific E2E tests

**Step 1: Add Kimi E2E tests**

```typescript
describe('E2E: kimi-code engine', () => {
  it('submit with --engine kimi-code creates run with correct engine field', () => {
    const stdout = execSync(
      `${CLI} submit --intent coding --workspace "${workspaceDir}" --message "Test task" --runs-dir "${runsDir}" --engine kimi-code`,
      { encoding: 'utf-8', cwd: CWD }
    );
    const output = JSON.parse(stdout.trim());
    expect(output.run_id).toMatch(/^run-/);

    const requestPath = path.join(runsDir, output.run_id, 'request.json');
    const request = JSON.parse(fs.readFileSync(requestPath, 'utf-8'));
    expect(request.engine).toBe('kimi-code');
  });

  it('submit --wait with kimi-code completes and returns result', () => {
    const stdout = execSync(
      `${CLI} submit --intent coding --workspace "${workspaceDir}" --message "Reply with exactly: hello from kimi" --runs-dir "${runsDir}" --engine kimi-code --wait --timeout 60000`,
      { encoding: 'utf-8', cwd: CWD, timeout: 90000 }
    );
    const result = JSON.parse(stdout.trim());
    expect(result.status).toBe('completed');
    expect(result.summary).toContain('hello from kimi');
  }, 90000);
});
```

**Step 2: Run E2E tests**

Run: `npx vitest run tests/integration/e2e.test.ts`
Expected: All tests PASS

**Step 3: Commit**

```bash
git add tests/integration/e2e.test.ts
git commit -m "test: add E2E integration tests for kimi-code engine"
```

---

### Task 8: Variant tests for edge cases

**Files:**
- Modify: `tests/engines/kimi-code.test.ts` — add edge case tests

**Step 1: Add variant tests**

- Empty content array: `{"role":"assistant","content":[]}`
- No text parts (only think): `{"role":"assistant","content":[{"type":"think","think":"hmm"}]}`
- Malformed JSON with valid last line
- Content with tool_use parts mixed in
- Very large text content near the 10MB boundary

**Step 2: Run tests**

Run: `npx vitest run tests/engines/kimi-code.test.ts`
Expected: All PASS

**Step 3: Commit**

```bash
git add tests/engines/kimi-code.test.ts
git commit -m "test: add edge case variant tests for KimiCodeEngine"
```

---

### Task 9: Optimization iteration (round 1) — Error messages and diagnostics

Review error handling paths, ensure Kimi-specific error messages are clear. Update the `doctor` command to check for `kimi` binary presence.

**Files:**
- Modify: `src/cli/commands/doctor.ts` — add kimi binary check

**Step 1: Run `npx vitest run` — baseline all green**

**Step 2: Add kimi binary check to doctor command**

**Step 3: Run full suite, commit**

---

### Task 10: Optimization iteration (round 2) — Token usage from text format

Add optional token usage parsing from Kimi's text output format as a secondary strategy. If `stream-json` returns no token data, try parsing `StatusUpdate(...)` block from stderr or a fallback text-format call.

**Decision: YAGNI** — Skip this unless the user explicitly needs token tracking for Kimi. The `tokenUsage: null` path is well-supported throughout the codebase.

---

### Task 11: Optimization iteration (round 3) — Code quality review

Full review of all new code:
- Ensure consistent error handling between engines
- Verify BaseEngine abstraction is clean
- Check for any TypeScript strict mode issues
- Run `npm run build` to verify compilation

---

### Task 12: Optimization iteration (round 4) — Final verification

Run full test suite, verify all E2E tests pass, ensure clean build:

```bash
npm run build && npx vitest run
```

Verify the branch is clean, all commits are conventional, ready for PR.

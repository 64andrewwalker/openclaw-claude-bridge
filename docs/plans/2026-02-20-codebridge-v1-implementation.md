# CodeBridge V1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a CLI-first bridge that lets OpenClaw delegate coding tasks to Claude Code CLI through a file-driven, session-aware protocol.

**Architecture:** TypeScript CLI (`codebridge`) with a daemon runner process. CLI writes request files, runner watches `.runs/` directory and dispatches to engine adapters. V1 implements Claude Code adapter only. All state persisted to filesystem for crash recovery.

**Tech Stack:** TypeScript, Node.js, Vitest (testing), Commander.js (CLI), chokidar (file watching), zod (schema validation)

**Methodology:** BDD scenarios first → TDD red-green-refactor per step. Every task starts with behavior scenarios, then writes failing tests, then minimal implementation.

---

## Task 1: Project Scaffold + TypeScript Setup

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `src/index.ts` (empty entry)
- Create: `.eslintrc.json`

**Step 1: Initialize Node.js project**

```bash
npm init -y
```

**Step 2: Install dependencies**

```bash
npm install typescript commander zod chokidar nanoid
npm install -D vitest @types/node tsx
```

**Step 3: Configure TypeScript**

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

**Step 4: Configure Vitest**

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    globals: true,
    root: '.',
    include: ['tests/**/*.test.ts'],
  },
});
```

**Step 5: Add scripts to package.json**

```json
{
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest",
    "dev": "tsx src/index.ts"
  }
}
```

**Step 6: Create empty entry point**

```typescript
// src/index.ts
export {};
```

**Step 7: Verify setup**

Run: `npx vitest run`
Expected: 0 tests, no errors

**Step 8: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts src/index.ts
git commit -m "chore: scaffold TypeScript project with Vitest"
```

---

## Task 2: Schema Types + Validation (zod)

### BDD Scenarios

```gherkin
Feature: Request and Result schema validation

  Scenario: Valid new task request is accepted
    Given a request with intent "coding", workspace "/tmp/project", and a message
    When the request is validated
    Then it passes validation with mode "new" and engine "claude-code"

  Scenario: Resume request includes session_id
    Given a request with mode "resume" and a valid session_id
    When the request is validated
    Then it passes validation

  Scenario: Request with missing workspace is rejected
    Given a request without a workspace_path
    When the request is validated
    Then it fails with error "workspace_path is required"

  Scenario: Request with dangerous workspace root is rejected
    Given a request with workspace_path "/"
    When the request is validated
    Then it fails with error about disallowed root path

  Scenario: Result with success status is valid
    Given a result with status "completed", summary, and session_id
    When the result is validated
    Then it passes validation

  Scenario: Result with failure includes error details
    Given a result with status "failed" and error code "ENGINE_TIMEOUT"
    When the result is validated
    Then it passes and error.retryable is true
```

**Files:**
- Create: `src/schemas/request.ts`
- Create: `src/schemas/result.ts`
- Create: `src/schemas/session.ts`
- Create: `src/schemas/errors.ts`
- Create: `tests/schemas/request.test.ts`
- Create: `tests/schemas/result.test.ts`

### TDD Steps

**Step 1: Write failing tests for request schema**

```typescript
// tests/schemas/request.test.ts
import { describe, it, expect } from 'vitest';
import { RequestSchema, validateRequest } from '../../src/schemas/request';

describe('RequestSchema', () => {
  it('accepts valid new task request', () => {
    const input = {
      task_id: 'task-001',
      intent: 'coding',
      workspace_path: '/tmp/project',
      message: 'Add a login page',
      engine: 'claude-code',
      mode: 'new',
    };
    const result = validateRequest(input);
    expect(result.success).toBe(true);
    expect(result.data?.session_id).toBeNull();
  });

  it('accepts valid resume request with session_id', () => {
    const input = {
      task_id: 'task-001',
      intent: 'coding',
      workspace_path: '/tmp/project',
      message: 'Now add tests',
      engine: 'claude-code',
      mode: 'resume',
      session_id: 'sess-abc123',
    };
    const result = validateRequest(input);
    expect(result.success).toBe(true);
    expect(result.data?.session_id).toBe('sess-abc123');
  });

  it('rejects request without workspace_path', () => {
    const input = {
      task_id: 'task-001',
      intent: 'coding',
      message: 'Do something',
      engine: 'claude-code',
      mode: 'new',
    };
    const result = validateRequest(input);
    expect(result.success).toBe(false);
  });

  it('rejects dangerous workspace root paths', () => {
    const dangerousPaths = ['/', '/etc', '/usr', '/System'];
    for (const p of dangerousPaths) {
      const input = {
        task_id: 'task-001',
        intent: 'coding',
        workspace_path: p,
        message: 'Do something',
        engine: 'claude-code',
        mode: 'new',
      };
      const result = validateRequest(input);
      expect(result.success).toBe(false);
    }
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/schemas/request.test.ts`
Expected: FAIL — cannot resolve `../../src/schemas/request`

**Step 3: Implement request schema**

```typescript
// src/schemas/request.ts
import { z } from 'zod';

const DANGEROUS_ROOTS = ['/', '/etc', '/usr', '/System', '/bin', '/sbin', '/var'];

export const RequestSchema = z.object({
  task_id: z.string().min(1),
  intent: z.enum(['coding', 'refactor', 'debug', 'ops']),
  workspace_path: z.string().min(1).refine(
    (p) => !DANGEROUS_ROOTS.includes(p),
    { message: 'Workspace path is a disallowed root path' }
  ),
  message: z.string().min(1),
  engine: z.string().default('claude-code'),
  mode: z.enum(['new', 'resume']).default('new'),
  session_id: z.string().nullable().default(null),
  constraints: z.object({
    timeout_ms: z.number().positive().default(1800000), // 30 min
    allow_network: z.boolean().default(true),
  }).default({}),
  allowed_roots: z.array(z.string()).optional(),
});

export type TaskRequest = z.infer<typeof RequestSchema>;

export function validateRequest(input: unknown) {
  return RequestSchema.safeParse(input);
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/schemas/request.test.ts`
Expected: PASS (all 4 tests)

**Step 5: Write failing tests for result schema**

```typescript
// tests/schemas/result.test.ts
import { describe, it, expect } from 'vitest';
import { validateResult } from '../../src/schemas/result';

describe('ResultSchema', () => {
  it('accepts valid success result', () => {
    const input = {
      run_id: 'run-001',
      status: 'completed',
      summary: 'Added login page with form validation',
      session_id: 'sess-abc123',
      artifacts: ['src/login.ts', 'tests/login.test.ts'],
      duration_ms: 45000,
      token_usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 },
    };
    const result = validateResult(input);
    expect(result.success).toBe(true);
  });

  it('accepts failed result with error details', () => {
    const input = {
      run_id: 'run-001',
      status: 'failed',
      summary: 'Engine timed out after 30 minutes',
      session_id: 'sess-abc123',
      artifacts: [],
      duration_ms: 1800000,
      token_usage: null,
      error: {
        code: 'ENGINE_TIMEOUT',
        message: 'Claude Code process exceeded timeout',
        retryable: true,
      },
    };
    const result = validateResult(input);
    expect(result.success).toBe(true);
    expect(result.data?.error?.retryable).toBe(true);
  });

  it('requires error details when status is failed', () => {
    const input = {
      run_id: 'run-001',
      status: 'failed',
      summary: 'Something went wrong',
      session_id: 'sess-abc123',
      artifacts: [],
      duration_ms: 5000,
      token_usage: null,
      // missing error
    };
    const result = validateResult(input);
    expect(result.success).toBe(false);
  });
});
```

**Step 6: Run test to verify it fails**

Run: `npx vitest run tests/schemas/result.test.ts`
Expected: FAIL

**Step 7: Implement result schema**

```typescript
// src/schemas/result.ts
import { z } from 'zod';

const ErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  retryable: z.boolean(),
});

const TokenUsageSchema = z.object({
  prompt_tokens: z.number(),
  completion_tokens: z.number(),
  total_tokens: z.number(),
}).nullable();

export const ResultSchema = z.object({
  run_id: z.string().min(1),
  status: z.enum(['completed', 'failed']),
  summary: z.string(),
  session_id: z.string(),
  artifacts: z.array(z.string()),
  duration_ms: z.number(),
  token_usage: TokenUsageSchema,
  error: ErrorSchema.optional(),
}).refine(
  (data) => data.status !== 'failed' || data.error !== undefined,
  { message: 'error is required when status is failed', path: ['error'] }
);

export type TaskResult = z.infer<typeof ResultSchema>;

export function validateResult(input: unknown) {
  return ResultSchema.safeParse(input);
}
```

**Step 8: Run test to verify it passes**

Run: `npx vitest run tests/schemas/result.test.ts`
Expected: PASS

**Step 9: Implement session and error schemas**

```typescript
// src/schemas/session.ts
import { z } from 'zod';

export const SessionSchema = z.object({
  run_id: z.string(),
  engine: z.string().default('claude-code'),
  session_id: z.string().nullable().default(null),
  state: z.enum(['created', 'running', 'stopping', 'completed', 'failed']),
  pid: z.number().nullable().default(null),
  created_at: z.string().datetime(),
  last_active_at: z.string().datetime(),
});

export type Session = z.infer<typeof SessionSchema>;
```

```typescript
// src/schemas/errors.ts
export const ERROR_CODES = {
  ENGINE_TIMEOUT: { category: 'engine', retryable: true, message: 'Engine execution timed out' },
  ENGINE_CRASH: { category: 'engine', retryable: true, message: 'Engine process crashed' },
  ENGINE_AUTH: { category: 'engine', retryable: false, message: 'Engine authentication failed' },
  NETWORK_ERROR: { category: 'network', retryable: true, message: 'Network connection failed' },
  WORKSPACE_INVALID: { category: 'input', retryable: false, message: 'Workspace path invalid or out of bounds' },
  WORKSPACE_NOT_FOUND: { category: 'input', retryable: false, message: 'Workspace directory not found' },
  REQUEST_INVALID: { category: 'input', retryable: false, message: 'Invalid request format' },
  RUNNER_CRASH_RECOVERY: { category: 'internal', retryable: true, message: 'Orphaned task from runner crash' },
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export function makeError(code: ErrorCode, detail?: string) {
  const info = ERROR_CODES[code];
  return {
    code,
    message: detail ?? info.message,
    retryable: info.retryable,
  };
}
```

**Step 10: Run all tests**

Run: `npx vitest run`
Expected: ALL PASS

**Step 11: Commit**

```bash
git add src/schemas/ tests/schemas/
git commit -m "feat: add request/result/session schemas with zod validation"
```

---

## Task 3: Run Directory Manager (file protocol + atomicity)

### BDD Scenarios

```gherkin
Feature: Run directory management

  Scenario: Creating a new run directory
    Given a valid task request
    When a run is created
    Then a .runs/<run_id>/ directory exists with request.json and session.json
    And request.json was written atomically (via tmp+rename)

  Scenario: Reading run status
    Given a run directory with session.json in state "running"
    When status is queried
    Then it returns the current session state

  Scenario: Listing all runs
    Given three run directories in different states
    When runs are listed
    Then all three are returned with their states

  Scenario: Atomic request consumption by runner
    Given a run directory with request.json
    When the runner consumes the request
    Then request.json is renamed to request.processing.json
    And no request.json exists anymore
```

**Files:**
- Create: `src/core/run-manager.ts`
- Create: `tests/core/run-manager.test.ts`

### TDD Steps

**Step 1: Write failing tests**

```typescript
// tests/core/run-manager.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RunManager } from '../../src/core/run-manager';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('RunManager', () => {
  let runsDir: string;
  let manager: RunManager;

  beforeEach(() => {
    runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codebridge-test-'));
    manager = new RunManager(runsDir);
  });

  afterEach(() => {
    fs.rmSync(runsDir, { recursive: true, force: true });
  });

  it('creates a run directory with request.json and session.json', async () => {
    const request = {
      task_id: 'task-001',
      intent: 'coding' as const,
      workspace_path: '/tmp/project',
      message: 'Add login',
      engine: 'claude-code',
      mode: 'new' as const,
    };

    const runId = await manager.createRun(request);

    const runDir = path.join(runsDir, runId);
    expect(fs.existsSync(path.join(runDir, 'request.json'))).toBe(true);
    expect(fs.existsSync(path.join(runDir, 'session.json'))).toBe(true);
    // Verify atomicity: no .tmp file left behind
    expect(fs.existsSync(path.join(runDir, 'request.tmp'))).toBe(false);
  });

  it('reads run status from session.json', async () => {
    const request = {
      task_id: 'task-001',
      intent: 'coding' as const,
      workspace_path: '/tmp/project',
      message: 'Add login',
      engine: 'claude-code',
      mode: 'new' as const,
    };

    const runId = await manager.createRun(request);
    const status = await manager.getStatus(runId);

    expect(status.state).toBe('created');
    expect(status.engine).toBe('claude-code');
  });

  it('lists all runs with their states', async () => {
    const base = {
      intent: 'coding' as const,
      workspace_path: '/tmp/project',
      message: 'Do something',
      engine: 'claude-code',
      mode: 'new' as const,
    };

    await manager.createRun({ ...base, task_id: 'task-1' });
    await manager.createRun({ ...base, task_id: 'task-2' });
    await manager.createRun({ ...base, task_id: 'task-3' });

    const runs = await manager.listRuns();
    expect(runs).toHaveLength(3);
    expect(runs.every((r) => r.state === 'created')).toBe(true);
  });

  it('atomically consumes request.json for processing', async () => {
    const request = {
      task_id: 'task-001',
      intent: 'coding' as const,
      workspace_path: '/tmp/project',
      message: 'Add login',
      engine: 'claude-code',
      mode: 'new' as const,
    };

    const runId = await manager.createRun(request);
    const consumed = await manager.consumeRequest(runId);

    const runDir = path.join(runsDir, runId);
    expect(consumed).not.toBeNull();
    expect(fs.existsSync(path.join(runDir, 'request.json'))).toBe(false);
    expect(fs.existsSync(path.join(runDir, 'request.processing.json'))).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/run-manager.test.ts`
Expected: FAIL — cannot resolve `run-manager`

**Step 3: Implement RunManager**

```typescript
// src/core/run-manager.ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import { nanoid } from 'nanoid';
import type { TaskRequest } from '../schemas/request.js';
import type { Session } from '../schemas/session.js';

export class RunManager {
  constructor(private runsDir: string) {
    fs.mkdirSync(runsDir, { recursive: true });
  }

  async createRun(request: Omit<TaskRequest, 'constraints' | 'session_id' | 'allowed_roots'> & Partial<TaskRequest>): Promise<string> {
    const runId = `run-${nanoid(12)}`;
    const runDir = path.join(this.runsDir, runId);

    fs.mkdirSync(runDir, { recursive: true });
    fs.mkdirSync(path.join(runDir, 'context'), { recursive: true });
    fs.mkdirSync(path.join(runDir, 'logs'), { recursive: true });
    fs.mkdirSync(path.join(runDir, 'artifacts'), { recursive: true });

    // Atomic write: tmp → rename
    const requestTmp = path.join(runDir, 'request.tmp');
    const requestFinal = path.join(runDir, 'request.json');
    fs.writeFileSync(requestTmp, JSON.stringify({ ...request, run_id: runId }, null, 2));
    fs.renameSync(requestTmp, requestFinal);

    // Write session.json
    const now = new Date().toISOString();
    const session: Session = {
      run_id: runId,
      engine: request.engine ?? 'claude-code',
      session_id: request.session_id ?? null,
      state: 'created',
      pid: null,
      created_at: now,
      last_active_at: now,
    };
    fs.writeFileSync(path.join(runDir, 'session.json'), JSON.stringify(session, null, 2));

    return runId;
  }

  async getStatus(runId: string): Promise<Session> {
    const sessionPath = path.join(this.runsDir, runId, 'session.json');
    const raw = fs.readFileSync(sessionPath, 'utf-8');
    return JSON.parse(raw) as Session;
  }

  async listRuns(): Promise<Array<Session & { run_id: string }>> {
    const entries = fs.readdirSync(this.runsDir, { withFileTypes: true });
    const runs: Array<Session & { run_id: string }> = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const sessionPath = path.join(this.runsDir, entry.name, 'session.json');
      if (!fs.existsSync(sessionPath)) continue;
      const raw = fs.readFileSync(sessionPath, 'utf-8');
      runs.push({ ...JSON.parse(raw), run_id: entry.name });
    }

    return runs;
  }

  async consumeRequest(runId: string): Promise<TaskRequest | null> {
    const runDir = path.join(this.runsDir, runId);
    const requestPath = path.join(runDir, 'request.json');
    const processingPath = path.join(runDir, 'request.processing.json');

    if (!fs.existsSync(requestPath)) return null;

    const raw = fs.readFileSync(requestPath, 'utf-8');
    fs.renameSync(requestPath, processingPath);

    return JSON.parse(raw) as TaskRequest;
  }

  async updateSession(runId: string, updates: Partial<Session>): Promise<void> {
    const sessionPath = path.join(this.runsDir, runId, 'session.json');
    const current = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
    const updated = { ...current, ...updates, last_active_at: new Date().toISOString() };
    fs.writeFileSync(sessionPath, JSON.stringify(updated, null, 2));
  }

  async writeResult(runId: string, result: Record<string, unknown>): Promise<void> {
    const resultPath = path.join(this.runsDir, runId, 'result.json');
    fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));
  }

  getRunDir(runId: string): string {
    return path.join(this.runsDir, runId);
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/run-manager.test.ts`
Expected: PASS (all 4 tests)

**Step 5: Commit**

```bash
git add src/core/run-manager.ts tests/core/run-manager.test.ts
git commit -m "feat: add RunManager with atomic file protocol"
```

---

## Task 4: Engine Interface + Claude Code Adapter

### BDD Scenarios

```gherkin
Feature: Engine abstraction and Claude Code adapter

  Scenario: Engine interface defines a standard contract
    Given an engine adapter implementing the Engine interface
    When start() is called with a task request
    Then it returns session info with a session_id and pid

  Scenario: Claude Code adapter invokes claude CLI for new task
    Given a Claude Code engine adapter
    When start() is called with intent "coding" and message "Add login page"
    Then it spawns `claude` with --print flag and the message
    And captures the output as the response

  Scenario: Claude Code adapter resumes existing session
    Given a Claude Code engine adapter and an existing session_id
    When send() is called with a follow-up message
    Then it spawns `claude` with --resume <session_id> and --print flags

  Scenario: Claude Code adapter reports failure on non-zero exit
    Given a Claude Code engine adapter
    When the claude process exits with code 1
    Then the adapter returns a failed response with ENGINE_CRASH error

  Scenario: Claude Code adapter enforces timeout
    Given a Claude Code engine adapter with 5 second timeout
    When the claude process runs longer than 5 seconds
    Then the process is killed and ENGINE_TIMEOUT error is returned
```

**Files:**
- Create: `src/core/engine.ts`
- Create: `src/engines/claude-code.ts`
- Create: `tests/engines/claude-code.test.ts`

### TDD Steps

**Step 1: Write failing tests**

```typescript
// tests/engines/claude-code.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClaudeCodeEngine } from '../../src/engines/claude-code';
import type { TaskRequest } from '../../src/schemas/request';

// We'll test with a mock command to avoid requiring actual claude CLI
describe('ClaudeCodeEngine', () => {
  let engine: ClaudeCodeEngine;

  beforeEach(() => {
    // Use 'echo' as a stand-in for claude CLI in tests
    engine = new ClaudeCodeEngine({ command: 'echo' });
  });

  it('starts a new session and returns session info', async () => {
    const request: TaskRequest = {
      task_id: 'task-001',
      intent: 'coding',
      workspace_path: '/tmp/project',
      message: 'Hello world',
      engine: 'claude-code',
      mode: 'new',
      session_id: null,
      constraints: { timeout_ms: 30000, allow_network: true },
    };

    const result = await engine.start(request);

    expect(result.pid).toBeTypeOf('number');
    expect(result.output).toBeDefined();
  });

  it('returns error on non-zero exit code', async () => {
    engine = new ClaudeCodeEngine({ command: 'false' }); // exits with 1

    const request: TaskRequest = {
      task_id: 'task-001',
      intent: 'coding',
      workspace_path: '/tmp/project',
      message: 'This will fail',
      engine: 'claude-code',
      mode: 'new',
      session_id: null,
      constraints: { timeout_ms: 30000, allow_network: true },
    };

    const result = await engine.start(request);

    expect(result.error).toBeDefined();
    expect(result.error?.code).toBe('ENGINE_CRASH');
  });

  it('kills process on timeout and returns ENGINE_TIMEOUT', async () => {
    engine = new ClaudeCodeEngine({ command: 'sleep', defaultArgs: ['10'] });

    const request: TaskRequest = {
      task_id: 'task-001',
      intent: 'coding',
      workspace_path: '/tmp/project',
      message: 'Slow task',
      engine: 'claude-code',
      mode: 'new',
      session_id: null,
      constraints: { timeout_ms: 500, allow_network: true }, // 500ms timeout
    };

    const result = await engine.start(request);

    expect(result.error).toBeDefined();
    expect(result.error?.code).toBe('ENGINE_TIMEOUT');
  }, 10000);
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engines/claude-code.test.ts`
Expected: FAIL

**Step 3: Implement Engine interface**

```typescript
// src/core/engine.ts
import type { TaskRequest } from '../schemas/request.js';

export interface EngineError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface EngineResponse {
  output: string;
  pid: number;
  exitCode: number | null;
  sessionId: string | null;
  error?: EngineError;
  tokenUsage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  } | null;
}

export interface Engine {
  start(task: TaskRequest): Promise<EngineResponse>;
  send(sessionId: string, message: string, opts?: { timeoutMs?: number; cwd?: string }): Promise<EngineResponse>;
  stop(pid: number): Promise<void>;
}
```

**Step 4: Implement Claude Code adapter**

```typescript
// src/engines/claude-code.ts
import { spawn } from 'node:child_process';
import type { Engine, EngineResponse } from '../core/engine.js';
import type { TaskRequest } from '../schemas/request.js';
import { makeError } from '../schemas/errors.js';

export interface ClaudeCodeOptions {
  command?: string;        // default: 'claude'
  defaultArgs?: string[];  // for testing
}

export class ClaudeCodeEngine implements Engine {
  private command: string;
  private defaultArgs: string[];

  constructor(opts?: ClaudeCodeOptions) {
    this.command = opts?.command ?? 'claude';
    this.defaultArgs = opts?.defaultArgs ?? [];
  }

  async start(task: TaskRequest): Promise<EngineResponse> {
    const args = this.buildStartArgs(task);
    return this.exec(args, task.constraints?.timeout_ms ?? 1800000, task.workspace_path);
  }

  async send(sessionId: string, message: string, opts?: { timeoutMs?: number; cwd?: string }): Promise<EngineResponse> {
    const args = ['--resume', sessionId, '--print', '-p', message];
    return this.exec(args, opts?.timeoutMs ?? 1800000, opts?.cwd);
  }

  async stop(pid: number): Promise<void> {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // Process already exited
    }
  }

  private buildStartArgs(task: TaskRequest): string[] {
    if (this.defaultArgs.length > 0) {
      // Test mode: use default args (e.g., for echo/sleep commands)
      return [...this.defaultArgs];
    }
    return ['--print', '-p', task.message];
  }

  private exec(args: string[], timeoutMs: number, cwd?: string): Promise<EngineResponse> {
    return new Promise((resolve) => {
      const child = spawn(this.command, args, {
        cwd: cwd || process.cwd(),
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 3000);
      }, timeoutMs);

      child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

      child.on('close', (code) => {
        clearTimeout(timer);

        if (timedOut) {
          resolve({
            output: stdout,
            pid: child.pid ?? 0,
            exitCode: code,
            sessionId: null,
            error: makeError('ENGINE_TIMEOUT', `Process killed after ${timeoutMs}ms`),
          });
          return;
        }

        if (code !== 0) {
          resolve({
            output: stdout,
            pid: child.pid ?? 0,
            exitCode: code,
            sessionId: null,
            error: makeError('ENGINE_CRASH', stderr || `Process exited with code ${code}`),
          });
          return;
        }

        resolve({
          output: stdout.trim(),
          pid: child.pid ?? 0,
          exitCode: 0,
          sessionId: this.extractSessionId(stderr + stdout),
          tokenUsage: this.extractTokenUsage(stderr + stdout),
        });
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({
          output: '',
          pid: child.pid ?? 0,
          exitCode: null,
          sessionId: null,
          error: makeError('ENGINE_CRASH', err.message),
        });
      });
    });
  }

  private extractSessionId(output: string): string | null {
    // Claude Code outputs session info — parse it if available
    // This is a placeholder; real implementation parses claude's JSON output
    const match = output.match(/"session_id"\s*:\s*"([^"]+)"/);
    return match?.[1] ?? null;
  }

  private extractTokenUsage(output: string): { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null {
    // Placeholder for parsing token usage from claude output
    return null;
  }
}
```

**Step 5: Run test to verify it passes**

Run: `npx vitest run tests/engines/claude-code.test.ts`
Expected: PASS (all 3 tests)

**Step 6: Commit**

```bash
git add src/core/engine.ts src/engines/claude-code.ts tests/engines/claude-code.test.ts
git commit -m "feat: add Engine interface and Claude Code adapter"
```

---

## Task 5: Session Manager

### BDD Scenarios

```gherkin
Feature: Session lifecycle management

  Scenario: New task creates a new session in "created" state
    Given a run with no existing session
    When session manager initializes the session
    Then session state is "created" with engine and timestamps

  Scenario: Session transitions from created to running
    Given a session in "created" state
    When the engine starts and returns a pid
    Then session state becomes "running" with the pid recorded

  Scenario: Session transitions from running to completed
    Given a session in "running" state
    When the engine completes successfully
    Then session state becomes "completed"

  Scenario: Session transitions from running to failed
    Given a session in "running" state
    When the engine returns a non-retryable error
    Then session state becomes "failed"

  Scenario: Invalid state transition is rejected
    Given a session in "completed" state
    When a transition to "running" is attempted
    Then the transition is rejected with an error
```

**Files:**
- Create: `src/core/session-manager.ts`
- Create: `tests/core/session-manager.test.ts`

### TDD Steps

**Step 1: Write failing tests**

```typescript
// tests/core/session-manager.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SessionManager } from '../../src/core/session-manager';
import { RunManager } from '../../src/core/run-manager';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('SessionManager', () => {
  let runsDir: string;
  let runManager: RunManager;
  let sessionManager: SessionManager;

  beforeEach(() => {
    runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codebridge-session-'));
    runManager = new RunManager(runsDir);
    sessionManager = new SessionManager(runManager);
  });

  afterEach(() => {
    fs.rmSync(runsDir, { recursive: true, force: true });
  });

  it('initializes session in created state', async () => {
    const runId = await runManager.createRun({
      task_id: 'task-001',
      intent: 'coding',
      workspace_path: '/tmp/project',
      message: 'Add login',
      engine: 'claude-code',
      mode: 'new',
    });

    const session = await sessionManager.getSession(runId);
    expect(session.state).toBe('created');
  });

  it('transitions from created to running with pid', async () => {
    const runId = await runManager.createRun({
      task_id: 'task-001',
      intent: 'coding',
      workspace_path: '/tmp/project',
      message: 'Add login',
      engine: 'claude-code',
      mode: 'new',
    });

    await sessionManager.transition(runId, 'running', { pid: 12345, session_id: 'sess-abc' });

    const session = await sessionManager.getSession(runId);
    expect(session.state).toBe('running');
    expect(session.pid).toBe(12345);
    expect(session.session_id).toBe('sess-abc');
  });

  it('transitions from running to completed', async () => {
    const runId = await runManager.createRun({
      task_id: 'task-001',
      intent: 'coding',
      workspace_path: '/tmp/project',
      message: 'Add login',
      engine: 'claude-code',
      mode: 'new',
    });

    await sessionManager.transition(runId, 'running', { pid: 12345 });
    await sessionManager.transition(runId, 'completed');

    const session = await sessionManager.getSession(runId);
    expect(session.state).toBe('completed');
  });

  it('transitions from running to failed', async () => {
    const runId = await runManager.createRun({
      task_id: 'task-001',
      intent: 'coding',
      workspace_path: '/tmp/project',
      message: 'Add login',
      engine: 'claude-code',
      mode: 'new',
    });

    await sessionManager.transition(runId, 'running', { pid: 12345 });
    await sessionManager.transition(runId, 'failed');

    const session = await sessionManager.getSession(runId);
    expect(session.state).toBe('failed');
  });

  it('rejects invalid state transitions', async () => {
    const runId = await runManager.createRun({
      task_id: 'task-001',
      intent: 'coding',
      workspace_path: '/tmp/project',
      message: 'Add login',
      engine: 'claude-code',
      mode: 'new',
    });

    await sessionManager.transition(runId, 'running', { pid: 12345 });
    await sessionManager.transition(runId, 'completed');

    await expect(
      sessionManager.transition(runId, 'running')
    ).rejects.toThrow(/invalid state transition/i);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/session-manager.test.ts`
Expected: FAIL

**Step 3: Implement SessionManager**

```typescript
// src/core/session-manager.ts
import type { RunManager } from './run-manager.js';
import type { Session } from '../schemas/session.js';

const VALID_TRANSITIONS: Record<string, string[]> = {
  created: ['running'],
  running: ['completed', 'failed', 'stopping'],
  stopping: ['completed', 'failed'],
  // completed and failed are terminal — no transitions out
};

export class SessionManager {
  constructor(private runManager: RunManager) {}

  async getSession(runId: string): Promise<Session> {
    return this.runManager.getStatus(runId);
  }

  async transition(
    runId: string,
    newState: Session['state'],
    updates?: Partial<Pick<Session, 'pid' | 'session_id'>>
  ): Promise<Session> {
    const current = await this.getSession(runId);
    const allowed = VALID_TRANSITIONS[current.state] ?? [];

    if (!allowed.includes(newState)) {
      throw new Error(
        `Invalid state transition: ${current.state} → ${newState} (allowed: ${allowed.join(', ') || 'none'})`
      );
    }

    await this.runManager.updateSession(runId, {
      state: newState,
      ...updates,
    });

    return this.getSession(runId);
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/session-manager.test.ts`
Expected: PASS (all 5 tests)

**Step 5: Commit**

```bash
git add src/core/session-manager.ts tests/core/session-manager.test.ts
git commit -m "feat: add SessionManager with state machine validation"
```

---

## Task 6: Task Runner (orchestration)

### BDD Scenarios

```gherkin
Feature: Task runner orchestrates request → engine → result

  Scenario: Runner executes a new task end-to-end
    Given a run directory with a pending request
    When the runner processes the request
    Then it transitions session created → running → completed
    And writes result.json with status "completed" and a summary

  Scenario: Runner handles engine failure
    Given a run directory with a pending request
    When the engine returns an error
    Then session transitions to "failed"
    And result.json contains the error code and retryable flag

  Scenario: Runner validates workspace before execution
    Given a request with workspace_path pointing to a non-existent directory
    When the runner processes the request
    Then it fails immediately with WORKSPACE_NOT_FOUND error
    And the engine is never invoked
```

**Files:**
- Create: `src/core/runner.ts`
- Create: `tests/core/runner.test.ts`

### TDD Steps

**Step 1: Write failing tests**

```typescript
// tests/core/runner.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TaskRunner } from '../../src/core/runner';
import { RunManager } from '../../src/core/run-manager';
import { SessionManager } from '../../src/core/session-manager';
import { ClaudeCodeEngine } from '../../src/engines/claude-code';
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
    // Use echo as engine — always succeeds
    const engine = new ClaudeCodeEngine({ command: 'echo', defaultArgs: ['task completed'] });
    const runner = new TaskRunner(runManager, sessionManager, engine);

    const runId = await runManager.createRun({
      task_id: 'task-001',
      intent: 'coding',
      workspace_path: workspaceDir,
      message: 'Add login',
      engine: 'claude-code',
      mode: 'new',
    });

    await runner.processRun(runId);

    const session = await sessionManager.getSession(runId);
    expect(session.state).toBe('completed');

    const resultPath = path.join(runsDir, runId, 'result.json');
    expect(fs.existsSync(resultPath)).toBe(true);

    const result = JSON.parse(fs.readFileSync(resultPath, 'utf-8'));
    expect(result.status).toBe('completed');
    expect(result.summary).toBeDefined();
  });

  it('handles engine failure and writes error to result', async () => {
    const engine = new ClaudeCodeEngine({ command: 'false' }); // exits with 1
    const runner = new TaskRunner(runManager, sessionManager, engine);

    const runId = await runManager.createRun({
      task_id: 'task-001',
      intent: 'coding',
      workspace_path: workspaceDir,
      message: 'This will fail',
      engine: 'claude-code',
      mode: 'new',
    });

    await runner.processRun(runId);

    const session = await sessionManager.getSession(runId);
    expect(session.state).toBe('failed');

    const resultPath = path.join(runsDir, runId, 'result.json');
    const result = JSON.parse(fs.readFileSync(resultPath, 'utf-8'));
    expect(result.status).toBe('failed');
    expect(result.error.code).toBe('ENGINE_CRASH');
  });

  it('rejects non-existent workspace without invoking engine', async () => {
    const engine = new ClaudeCodeEngine({ command: 'echo', defaultArgs: ['should not run'] });
    const runner = new TaskRunner(runManager, sessionManager, engine);

    const runId = await runManager.createRun({
      task_id: 'task-001',
      intent: 'coding',
      workspace_path: '/nonexistent/path/12345',
      message: 'This workspace does not exist',
      engine: 'claude-code',
      mode: 'new',
    });

    await runner.processRun(runId);

    const session = await sessionManager.getSession(runId);
    expect(session.state).toBe('failed');

    const resultPath = path.join(runsDir, runId, 'result.json');
    const result = JSON.parse(fs.readFileSync(resultPath, 'utf-8'));
    expect(result.error.code).toBe('WORKSPACE_NOT_FOUND');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/runner.test.ts`
Expected: FAIL

**Step 3: Implement TaskRunner**

```typescript
// src/core/runner.ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { RunManager } from './run-manager.js';
import type { SessionManager } from './session-manager.js';
import type { Engine } from './engine.js';
import { makeError } from '../schemas/errors.js';

export class TaskRunner {
  constructor(
    private runManager: RunManager,
    private sessionManager: SessionManager,
    private engine: Engine,
  ) {}

  async processRun(runId: string): Promise<void> {
    const startTime = Date.now();
    const request = await this.runManager.consumeRequest(runId);

    if (!request) {
      await this.fail(runId, startTime, makeError('REQUEST_INVALID', 'No request.json found'));
      return;
    }

    // Validate workspace
    if (!fs.existsSync(request.workspace_path) || !fs.statSync(request.workspace_path).isDirectory()) {
      await this.fail(runId, startTime, makeError('WORKSPACE_NOT_FOUND', `Workspace not found: ${request.workspace_path}`));
      return;
    }

    // Transition to running
    const engineResponse = await (async () => {
      if (request.mode === 'resume' && request.session_id) {
        await this.sessionManager.transition(runId, 'running', { session_id: request.session_id });
        return this.engine.send(request.session_id, request.message, {
          timeoutMs: request.constraints?.timeout_ms,
          cwd: request.workspace_path,
        });
      } else {
        await this.sessionManager.transition(runId, 'running');
        return this.engine.start(request);
      }
    })();

    // Update session with pid and session_id from engine
    if (engineResponse.pid) {
      await this.runManager.updateSession(runId, {
        pid: engineResponse.pid,
        session_id: engineResponse.sessionId ?? undefined,
      });
    }

    const durationMs = Date.now() - startTime;

    if (engineResponse.error) {
      await this.fail(runId, startTime, engineResponse.error, engineResponse);
      return;
    }

    // Success
    await this.sessionManager.transition(runId, 'completed');
    await this.runManager.writeResult(runId, {
      run_id: runId,
      status: 'completed',
      summary: engineResponse.output.slice(0, 2000),
      session_id: engineResponse.sessionId ?? '',
      artifacts: [],
      duration_ms: durationMs,
      token_usage: engineResponse.tokenUsage ?? null,
    });
  }

  private async fail(
    runId: string,
    startTime: number,
    error: { code: string; message: string; retryable: boolean },
    engineResponse?: { output?: string; sessionId?: string | null; tokenUsage?: unknown },
  ): Promise<void> {
    // Transition to failed (may fail if already in terminal state)
    try {
      const session = await this.sessionManager.getSession(runId);
      if (session.state !== 'failed' && session.state !== 'completed') {
        if (session.state === 'created') {
          await this.sessionManager.transition(runId, 'running');
        }
        await this.sessionManager.transition(runId, 'failed');
      }
    } catch {
      // Best effort
    }

    await this.runManager.writeResult(runId, {
      run_id: runId,
      status: 'failed',
      summary: error.message,
      session_id: engineResponse?.sessionId ?? '',
      artifacts: [],
      duration_ms: Date.now() - startTime,
      token_usage: null,
      error,
    });
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/runner.test.ts`
Expected: PASS (all 3 tests)

**Step 5: Commit**

```bash
git add src/core/runner.ts tests/core/runner.test.ts
git commit -m "feat: add TaskRunner with workspace validation and error handling"
```

---

## Task 7: CLI Commands (submit / status / resume / stop / logs / doctor)

### BDD Scenarios

```gherkin
Feature: CLI interface for codebridge

  Scenario: Submit a new task (no-wait, default)
    Given a valid workspace directory
    When the user runs `codebridge submit --intent coding --workspace /path --message "Add login"`
    Then a run directory is created
    And the CLI prints JSON with run_id and status "created" to stdout
    And exits with code 0

  Scenario: Submit with --wait blocks until completion
    Given a valid workspace directory
    When the user runs `codebridge submit --wait --intent coding --workspace /path --message "Add login"`
    Then the CLI blocks until the task completes
    And prints the full result JSON to stdout

  Scenario: Query status of a run
    Given an existing run with id "run-abc123"
    When the user runs `codebridge status run-abc123`
    Then the CLI prints the session state as JSON

  Scenario: Resume an existing session
    Given a completed run with a session_id
    When the user runs `codebridge resume run-abc123 --message "Now add tests"`
    Then a new request is created in the same run directory with mode "resume"

  Scenario: Stop a running task
    Given a run in "running" state with pid 12345
    When the user runs `codebridge stop run-abc123`
    Then the engine process is terminated
    And session state transitions to "stopping"

  Scenario: Doctor checks environment
    When the user runs `codebridge doctor`
    Then it checks: claude CLI exists, node version, runs directory writable
    And prints a diagnostic report
```

**Files:**
- Create: `src/cli/index.ts`
- Create: `src/cli/commands/submit.ts`
- Create: `src/cli/commands/status.ts`
- Create: `src/cli/commands/resume.ts`
- Create: `src/cli/commands/stop.ts`
- Create: `src/cli/commands/logs.ts`
- Create: `src/cli/commands/doctor.ts`
- Create: `tests/cli/submit.test.ts`
- Create: `tests/cli/status.test.ts`
- Create: `tests/cli/doctor.test.ts`

### TDD Steps

**Step 1: Write failing test for submit command**

```typescript
// tests/cli/submit.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('codebridge submit', () => {
  let workspaceDir: string;
  let runsDir: string;

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-ws-'));
    runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-runs-'));
  });

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
    fs.rmSync(runsDir, { recursive: true, force: true });
  });

  it('creates a run and outputs JSON with run_id (no-wait)', () => {
    const result = execSync(
      `npx tsx src/cli/index.ts submit --intent coding --workspace "${workspaceDir}" --message "Add login" --runs-dir "${runsDir}" --no-wait`,
      { encoding: 'utf-8' }
    );

    const output = JSON.parse(result.trim());
    expect(output.run_id).toBeDefined();
    expect(output.status).toBe('created');

    // Verify run directory was created
    const runDir = path.join(runsDir, output.run_id);
    expect(fs.existsSync(runDir)).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cli/submit.test.ts`
Expected: FAIL

**Step 3: Implement CLI entry point and submit command**

```typescript
// src/cli/index.ts
import { Command } from 'commander';
import { submitCommand } from './commands/submit.js';
import { statusCommand } from './commands/status.js';
import { resumeCommand } from './commands/resume.js';
import { stopCommand } from './commands/stop.js';
import { logsCommand } from './commands/logs.js';
import { doctorCommand } from './commands/doctor.js';

const program = new Command();

program
  .name('codebridge')
  .description('CLI bridge for delegating coding tasks to AI engines')
  .version('0.1.0');

program.addCommand(submitCommand());
program.addCommand(statusCommand());
program.addCommand(resumeCommand());
program.addCommand(stopCommand());
program.addCommand(logsCommand());
program.addCommand(doctorCommand());

program.parse();
```

```typescript
// src/cli/commands/submit.ts
import { Command } from 'commander';
import { RunManager } from '../../core/run-manager.js';
import path from 'node:path';

export function submitCommand(): Command {
  return new Command('submit')
    .description('Submit a new coding task')
    .requiredOption('--intent <type>', 'Task intent: coding, refactor, debug, ops')
    .requiredOption('--workspace <path>', 'Workspace directory path')
    .requiredOption('--message <text>', 'Task description / prompt')
    .option('--engine <name>', 'Engine to use', 'claude-code')
    .option('--wait', 'Block until task completes', false)
    .option('--no-wait', 'Return immediately with run_id')
    .option('--timeout <ms>', 'Timeout in milliseconds', '1800000')
    .option('--runs-dir <path>', 'Runs directory', path.join(process.cwd(), '.runs'))
    .action(async (opts) => {
      const runManager = new RunManager(opts.runsDir);

      const runId = await runManager.createRun({
        task_id: `task-${Date.now()}`,
        intent: opts.intent,
        workspace_path: path.resolve(opts.workspace),
        message: opts.message,
        engine: opts.engine,
        mode: 'new',
      });

      if (!opts.wait) {
        const output = { run_id: runId, status: 'created', created_at: new Date().toISOString() };
        process.stdout.write(JSON.stringify(output, null, 2) + '\n');
        return;
      }

      // --wait mode: process the run synchronously
      // Import dynamically to avoid circular deps at CLI parse time
      const { SessionManager } = await import('../../core/session-manager.js');
      const { ClaudeCodeEngine } = await import('../../engines/claude-code.js');
      const { TaskRunner } = await import('../../core/runner.js');

      const sessionManager = new SessionManager(runManager);
      const engine = new ClaudeCodeEngine();
      const runner = new TaskRunner(runManager, sessionManager, engine);

      await runner.processRun(runId);

      const resultPath = path.join(opts.runsDir, runId, 'result.json');
      const { readFileSync } = await import('node:fs');
      const result = readFileSync(resultPath, 'utf-8');
      process.stdout.write(result + '\n');
    });
}
```

```typescript
// src/cli/commands/status.ts
import { Command } from 'commander';
import { RunManager } from '../../core/run-manager.js';
import path from 'node:path';

export function statusCommand(): Command {
  return new Command('status')
    .description('Query status of a run')
    .argument('<run_id>', 'Run ID to query')
    .option('--runs-dir <path>', 'Runs directory', path.join(process.cwd(), '.runs'))
    .action(async (runId, opts) => {
      const runManager = new RunManager(opts.runsDir);
      const session = await runManager.getStatus(runId);
      process.stdout.write(JSON.stringify(session, null, 2) + '\n');
    });
}
```

```typescript
// src/cli/commands/resume.ts
import { Command } from 'commander';
import { RunManager } from '../../core/run-manager.js';
import path from 'node:path';

export function resumeCommand(): Command {
  return new Command('resume')
    .description('Send follow-up message to an existing session')
    .argument('<run_id>', 'Run ID to resume')
    .requiredOption('--message <text>', 'Follow-up message')
    .option('--wait', 'Block until task completes', false)
    .option('--runs-dir <path>', 'Runs directory', path.join(process.cwd(), '.runs'))
    .action(async (runId, opts) => {
      const runManager = new RunManager(opts.runsDir);
      const session = await runManager.getStatus(runId);

      // Create a resume request in the same run directory
      const { writeFileSync, renameSync } = await import('node:fs');
      const runDir = runManager.getRunDir(runId);
      const request = {
        task_id: session.run_id,
        intent: 'coding',
        workspace_path: process.cwd(),
        message: opts.message,
        engine: session.engine,
        mode: 'resume',
        session_id: session.session_id,
      };

      const tmpPath = path.join(runDir, 'request.tmp');
      const finalPath = path.join(runDir, 'request.json');
      writeFileSync(tmpPath, JSON.stringify(request, null, 2));
      renameSync(tmpPath, finalPath);

      const output = { run_id: runId, status: 'resume_queued', session_id: session.session_id };
      process.stdout.write(JSON.stringify(output, null, 2) + '\n');
    });
}
```

```typescript
// src/cli/commands/stop.ts
import { Command } from 'commander';
import { RunManager } from '../../core/run-manager.js';
import { SessionManager } from '../../core/session-manager.js';
import path from 'node:path';

export function stopCommand(): Command {
  return new Command('stop')
    .description('Stop a running task')
    .argument('<run_id>', 'Run ID to stop')
    .option('--runs-dir <path>', 'Runs directory', path.join(process.cwd(), '.runs'))
    .action(async (runId, opts) => {
      const runManager = new RunManager(opts.runsDir);
      const sessionManager = new SessionManager(runManager);
      const session = await runManager.getStatus(runId);

      if (session.state !== 'running') {
        process.stderr.write(`Run ${runId} is not running (state: ${session.state})\n`);
        process.exit(1);
      }

      await sessionManager.transition(runId, 'stopping');

      if (session.pid) {
        try { process.kill(session.pid, 'SIGTERM'); } catch { /* already dead */ }
      }

      process.stdout.write(JSON.stringify({ run_id: runId, status: 'stopping' }, null, 2) + '\n');
    });
}
```

```typescript
// src/cli/commands/logs.ts
import { Command } from 'commander';
import { RunManager } from '../../core/run-manager.js';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

export function logsCommand(): Command {
  return new Command('logs')
    .description('View logs for a run')
    .argument('<run_id>', 'Run ID')
    .option('--runs-dir <path>', 'Runs directory', path.join(process.cwd(), '.runs'))
    .action(async (runId, opts) => {
      const logsDir = path.join(opts.runsDir, runId, 'logs');
      if (!existsSync(logsDir)) {
        process.stderr.write(`No logs directory for run ${runId}\n`);
        process.exit(1);
      }
      const files = readdirSync(logsDir);
      for (const file of files) {
        const content = readFileSync(path.join(logsDir, file), 'utf-8');
        process.stdout.write(`=== ${file} ===\n${content}\n`);
      }
      if (files.length === 0) {
        process.stdout.write('No log files yet.\n');
      }
    });
}
```

```typescript
// src/cli/commands/doctor.ts
import { Command } from 'commander';
import { execSync } from 'node:child_process';
import { existsSync, accessSync, constants } from 'node:fs';
import path from 'node:path';

interface Check {
  name: string;
  status: 'ok' | 'warn' | 'fail';
  detail: string;
}

export function doctorCommand(): Command {
  return new Command('doctor')
    .description('Diagnose environment issues')
    .option('--runs-dir <path>', 'Runs directory', path.join(process.cwd(), '.runs'))
    .action(async (opts) => {
      const checks: Check[] = [];

      // Check Node.js version
      const nodeVersion = process.version;
      checks.push({
        name: 'Node.js',
        status: parseInt(nodeVersion.slice(1)) >= 18 ? 'ok' : 'warn',
        detail: nodeVersion,
      });

      // Check claude CLI
      try {
        const claudeVersion = execSync('claude --version 2>/dev/null', { encoding: 'utf-8' }).trim();
        checks.push({ name: 'Claude CLI', status: 'ok', detail: claudeVersion });
      } catch {
        checks.push({ name: 'Claude CLI', status: 'fail', detail: 'Not found in PATH' });
      }

      // Check runs directory
      try {
        if (existsSync(opts.runsDir)) {
          accessSync(opts.runsDir, constants.W_OK);
          checks.push({ name: 'Runs directory', status: 'ok', detail: opts.runsDir });
        } else {
          checks.push({ name: 'Runs directory', status: 'warn', detail: `${opts.runsDir} (will be created)` });
        }
      } catch {
        checks.push({ name: 'Runs directory', status: 'fail', detail: `${opts.runsDir} (not writable)` });
      }

      process.stdout.write(JSON.stringify({ checks }, null, 2) + '\n');
    });
}
```

**Step 4: Run test to verify submit works**

Run: `npx vitest run tests/cli/submit.test.ts`
Expected: PASS

**Step 5: Write and run doctor test**

```typescript
// tests/cli/doctor.test.ts
import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';

describe('codebridge doctor', () => {
  it('outputs diagnostic checks as JSON', () => {
    const result = execSync('npx tsx src/cli/index.ts doctor', { encoding: 'utf-8' });
    const output = JSON.parse(result.trim());
    expect(output.checks).toBeInstanceOf(Array);
    expect(output.checks.length).toBeGreaterThan(0);
    expect(output.checks[0]).toHaveProperty('name');
    expect(output.checks[0]).toHaveProperty('status');
  });
});
```

Run: `npx vitest run tests/cli/doctor.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/cli/ tests/cli/
git commit -m "feat: add CLI commands (submit, status, resume, stop, logs, doctor)"
```

---

## Task 8: Reconciliation on Startup

### BDD Scenarios

```gherkin
Feature: Runner reconciles state on startup

  Scenario: Orphaned running task with no process gets marked failed
    Given a run with session state "running" and pid 99999 (not running)
    And no result.json exists
    When the runner starts and reconciles
    Then session state becomes "failed" with error RUNNER_CRASH_RECOVERY

  Scenario: Completed task with result.json is reconciled correctly
    Given a run with session state "running" and pid 99999 (not running)
    And result.json exists with status "completed"
    When the runner starts and reconciles
    Then session state becomes "completed"

  Scenario: Still-running process is left alone
    Given a run with session state "running" and a pid that is still alive
    When the runner starts and reconciles
    Then session state remains "running"
```

**Files:**
- Create: `src/core/reconciler.ts`
- Create: `tests/core/reconciler.test.ts`

### TDD Steps

**Step 1: Write failing tests**

```typescript
// tests/core/reconciler.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Reconciler } from '../../src/core/reconciler';
import { RunManager } from '../../src/core/run-manager';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('Reconciler', () => {
  let runsDir: string;
  let runManager: RunManager;

  beforeEach(() => {
    runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codebridge-reconcile-'));
    runManager = new RunManager(runsDir);
  });

  afterEach(() => {
    fs.rmSync(runsDir, { recursive: true, force: true });
  });

  it('marks orphaned running task as failed', async () => {
    const runId = await runManager.createRun({
      task_id: 'task-001',
      intent: 'coding',
      workspace_path: '/tmp/project',
      message: 'Orphan',
      engine: 'claude-code',
      mode: 'new',
    });

    // Manually set to running with a dead pid
    await runManager.updateSession(runId, { state: 'running', pid: 99999 });

    const reconciler = new Reconciler(runManager);
    const actions = await reconciler.reconcile();

    expect(actions).toHaveLength(1);
    expect(actions[0].action).toBe('marked_failed');

    const session = await runManager.getStatus(runId);
    expect(session.state).toBe('failed');
  });

  it('reconciles completed task from result.json', async () => {
    const runId = await runManager.createRun({
      task_id: 'task-002',
      intent: 'coding',
      workspace_path: '/tmp/project',
      message: 'Completed',
      engine: 'claude-code',
      mode: 'new',
    });

    await runManager.updateSession(runId, { state: 'running', pid: 99999 });
    await runManager.writeResult(runId, { status: 'completed', summary: 'Done' });

    const reconciler = new Reconciler(runManager);
    const actions = await reconciler.reconcile();

    expect(actions).toHaveLength(1);
    expect(actions[0].action).toBe('marked_completed');

    const session = await runManager.getStatus(runId);
    expect(session.state).toBe('completed');
  });

  it('leaves still-running process alone', async () => {
    const runId = await runManager.createRun({
      task_id: 'task-003',
      intent: 'coding',
      workspace_path: '/tmp/project',
      message: 'Still running',
      engine: 'claude-code',
      mode: 'new',
    });

    // Use current process pid (guaranteed alive)
    await runManager.updateSession(runId, { state: 'running', pid: process.pid });

    const reconciler = new Reconciler(runManager);
    const actions = await reconciler.reconcile();

    expect(actions).toHaveLength(0);

    const session = await runManager.getStatus(runId);
    expect(session.state).toBe('running');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/reconciler.test.ts`
Expected: FAIL

**Step 3: Implement Reconciler**

```typescript
// src/core/reconciler.ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { RunManager } from './run-manager.js';
import { makeError } from '../schemas/errors.js';

interface ReconcileAction {
  runId: string;
  action: 'marked_failed' | 'marked_completed' | 'kept_running';
  detail: string;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // signal 0 = check existence
    return true;
  } catch {
    return false;
  }
}

export class Reconciler {
  constructor(private runManager: RunManager) {}

  async reconcile(): Promise<ReconcileAction[]> {
    const runs = await this.runManager.listRuns();
    const actions: ReconcileAction[] = [];

    for (const run of runs) {
      if (run.state !== 'running') continue;

      if (run.pid && isProcessAlive(run.pid)) {
        // Process still alive — leave it
        continue;
      }

      // Process is dead — check for result.json
      const resultPath = path.join(this.runManager.getRunDir(run.run_id), 'result.json');

      if (fs.existsSync(resultPath)) {
        const result = JSON.parse(fs.readFileSync(resultPath, 'utf-8'));
        const newState = result.status === 'completed' ? 'completed' : 'failed';
        await this.runManager.updateSession(run.run_id, { state: newState });
        actions.push({
          runId: run.run_id,
          action: newState === 'completed' ? 'marked_completed' : 'marked_failed',
          detail: `Reconciled from result.json (status: ${result.status})`,
        });
      } else {
        // No result, no process — orphaned
        await this.runManager.updateSession(run.run_id, { state: 'failed' });
        await this.runManager.writeResult(run.run_id, {
          run_id: run.run_id,
          status: 'failed',
          summary: 'Task orphaned after runner restart',
          session_id: run.session_id ?? '',
          artifacts: [],
          duration_ms: 0,
          token_usage: null,
          error: makeError('RUNNER_CRASH_RECOVERY'),
        });
        actions.push({
          runId: run.run_id,
          action: 'marked_failed',
          detail: `Orphaned task (pid ${run.pid} no longer running, no result.json)`,
        });
      }
    }

    return actions;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/reconciler.test.ts`
Expected: PASS (all 3 tests)

**Step 5: Commit**

```bash
git add src/core/reconciler.ts tests/core/reconciler.test.ts
git commit -m "feat: add Reconciler for crash recovery on startup"
```

---

## Task 9: OpenClaw Skill Definition

### BDD Scenario

```gherkin
Feature: OpenClaw codebridge skill

  Scenario: Skill file is well-formed
    Given the skill file at skill/codebridge/SKILL.md
    Then it has valid YAML frontmatter with name and description
    And the body contains CLI usage instructions
```

**Files:**
- Create: `skill/codebridge/SKILL.md`

**Step 1: Write the Skill file**

```markdown
---
name: codebridge
description: Delegate complex coding, refactoring, debugging, and ops tasks to a powerful coding engine via CLI.
---

# CodeBridge Skill

You have access to the `codebridge` CLI tool which delegates complex coding tasks to a powerful AI coding engine (Claude Code).

## When to Use

Use codebridge when the user's request involves:
- Complex code generation or refactoring across multiple files
- Debugging tasks requiring deep codebase analysis
- Operations tasks (deployment scripts, infrastructure changes)
- Any coding task that would benefit from a dedicated coding agent

## Commands

### Submit a new task

```bash
codebridge submit --intent <coding|refactor|debug|ops> --workspace <path> --message "<task description>"
```

Returns JSON: `{ "run_id": "...", "status": "created" }`

### Check task status

```bash
codebridge status <run_id>
```

### Send follow-up to existing session

```bash
codebridge resume <run_id> --message "<follow-up>"
```

Use resume when:
- The user provides additional context for the same task
- The user wants to refine or iterate on the previous result
- The task needs continuation (e.g., "now add tests for that")

Use a new submit when:
- The user starts a completely different task
- The previous task is completed and unrelated follow-up begins

### Stop a running task

```bash
codebridge stop <run_id>
```

### View logs

```bash
codebridge logs <run_id>
```

## Response Handling

Parse the JSON output and present to the user:
- **Success**: Show the summary. Mention artifacts if any were produced.
- **Failed + retryable**: Inform the user and offer to retry.
- **Failed + not retryable**: Explain the error and suggest corrective action.

## Error Codes

| Code | Meaning | Action |
|------|---------|--------|
| ENGINE_TIMEOUT | Task took too long | Suggest simplifying the task or increasing timeout |
| ENGINE_CRASH | Engine process crashed | Retry automatically if retryable=true |
| ENGINE_AUTH | Auth failure | Ask user to check credentials |
| WORKSPACE_NOT_FOUND | Bad path | Ask user to verify workspace path |
```

**Step 2: Commit**

```bash
git add skill/codebridge/SKILL.md
git commit -m "feat: add OpenClaw codebridge skill definition"
```

---

## Task 10: Integration Test — End-to-End

### BDD Scenario

```gherkin
Feature: End-to-end task execution

  Scenario: Submit task via CLI, engine runs, result returned
    Given a workspace directory with a simple file
    When the user runs `codebridge submit --wait --intent coding --workspace <dir> --message "echo hello"`
    Then the CLI outputs a result JSON with status "completed"
    And the .runs/ directory contains request, session, and result files

  Scenario: Submit + status polling
    Given a submitted task (no-wait)
    When the user polls `codebridge status <run_id>`
    Then it returns the current session state
```

**Files:**
- Create: `tests/integration/e2e.test.ts`

**Step 1: Write integration test**

```typescript
// tests/integration/e2e.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('E2E: codebridge CLI', () => {
  let workspaceDir: string;
  let runsDir: string;

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-e2e-ws-'));
    runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-e2e-runs-'));
    // Create a file in workspace so it's non-empty
    fs.writeFileSync(path.join(workspaceDir, 'hello.txt'), 'hello world');
  });

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
    fs.rmSync(runsDir, { recursive: true, force: true });
  });

  it('submit (no-wait) creates run and returns JSON', () => {
    const stdout = execSync(
      `npx tsx src/cli/index.ts submit --intent coding --workspace "${workspaceDir}" --message "Test task" --runs-dir "${runsDir}" --no-wait`,
      { encoding: 'utf-8' }
    );

    const output = JSON.parse(stdout.trim());
    expect(output.run_id).toMatch(/^run-/);
    expect(output.status).toBe('created');

    // Verify files exist
    const runDir = path.join(runsDir, output.run_id);
    expect(fs.existsSync(path.join(runDir, 'request.json'))).toBe(true);
    expect(fs.existsSync(path.join(runDir, 'session.json'))).toBe(true);
  });

  it('status returns session state', () => {
    // First submit
    const submitOut = execSync(
      `npx tsx src/cli/index.ts submit --intent coding --workspace "${workspaceDir}" --message "Test" --runs-dir "${runsDir}" --no-wait`,
      { encoding: 'utf-8' }
    );
    const { run_id } = JSON.parse(submitOut.trim());

    // Then status
    const statusOut = execSync(
      `npx tsx src/cli/index.ts status ${run_id} --runs-dir "${runsDir}"`,
      { encoding: 'utf-8' }
    );
    const session = JSON.parse(statusOut.trim());
    expect(session.state).toBe('created');
    expect(session.engine).toBe('claude-code');
  });

  it('doctor outputs diagnostic checks', () => {
    const stdout = execSync(
      `npx tsx src/cli/index.ts doctor --runs-dir "${runsDir}"`,
      { encoding: 'utf-8' }
    );
    const output = JSON.parse(stdout.trim());
    expect(output.checks).toBeInstanceOf(Array);
    expect(output.checks.find((c: { name: string }) => c.name === 'Node.js')).toBeDefined();
  });
});
```

**Step 2: Run integration tests**

Run: `npx vitest run tests/integration/e2e.test.ts`
Expected: PASS

**Step 3: Run full test suite**

Run: `npx vitest run`
Expected: ALL PASS

**Step 4: Commit**

```bash
git add tests/integration/e2e.test.ts
git commit -m "test: add end-to-end integration tests for CLI"
```

---

## Task 11: Package Configuration + bin Entry

**Files:**
- Modify: `package.json` — add `bin` field and `type: "module"`

**Step 1: Update package.json**

Add to package.json:
```json
{
  "name": "codebridge",
  "type": "module",
  "bin": {
    "codebridge": "./dist/cli/index.js"
  }
}
```

**Step 2: Build and verify**

Run: `npx tsc && node dist/cli/index.js --help`
Expected: Shows codebridge help with all subcommands

**Step 3: Run full test suite one final time**

Run: `npx vitest run`
Expected: ALL PASS

**Step 4: Commit**

```bash
git add package.json
git commit -m "chore: add bin entry and module type for codebridge CLI"
```

---

## Summary

| Task | Component | Tests | Commits |
|------|-----------|-------|---------|
| 1 | Project scaffold | 0 (setup) | 1 |
| 2 | Schemas (zod) | ~7 | 1 |
| 3 | RunManager | ~4 | 1 |
| 4 | Engine + Claude adapter | ~3 | 1 |
| 5 | SessionManager | ~5 | 1 |
| 6 | TaskRunner | ~3 | 1 |
| 7 | CLI commands | ~3 | 1 |
| 8 | Reconciler | ~3 | 1 |
| 9 | Skill definition | 0 (doc) | 1 |
| 10 | Integration tests | ~3 | 1 |
| 11 | Package config | 0 (config) | 1 |
| **Total** | | **~31 tests** | **11 commits** |

Each task follows: **BDD scenarios → failing test → minimal implementation → green → commit**.

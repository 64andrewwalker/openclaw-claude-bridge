/**
 * Adversarial tests for TaskRunner (src/core/runner.ts)
 *
 * These tests probe edge cases, security boundaries, and error paths NOT
 * covered by the existing runner.test.ts suite.  They are intentionally
 * hostile — every test is designed to find a bug rather than verify happy
 * paths.
 *
 * DO NOT modify production code to make failing tests pass.
 * Document failing tests as bugs in the investigation report.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { TaskRunner } from "../../src/core/runner.js";
import type { EngineResolver } from "../../src/core/runner.js";
import { RunManager } from "../../src/core/run-manager.js";
import { SessionManager } from "../../src/core/session-manager.js";
import type { Engine, EngineResponse } from "../../src/core/engine.js";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ---------------------------------------------------------------------------
// Shared setup helpers
// ---------------------------------------------------------------------------

function makeSuccessEngine(output = "done"): Engine {
  return {
    start: async () => ({
      output,
      pid: 1234,
      exitCode: 0,
      sessionId: "sess-abc",
      error: undefined,
    }),
    send: async () => ({
      output,
      pid: 1234,
      exitCode: 0,
      sessionId: "sess-abc",
      error: undefined,
    }),
    stop: async () => {},
  };
}

function makeErrorEngine(code = "ENGINE_CRASH", msg = "boom"): Engine {
  return {
    start: async () => ({
      output: "",
      pid: 1234,
      exitCode: 1,
      sessionId: null,
      error: { code, message: msg, retryable: true },
    }),
    send: async () => ({
      output: "",
      pid: 1234,
      exitCode: 1,
      sessionId: null,
      error: { code, message: msg, retryable: true },
    }),
    stop: async () => {},
  };
}

function makeThrowingEngine(errorMessage = "engine exploded"): Engine {
  return {
    start: async () => {
      throw new Error(errorMessage);
    },
    send: async () => {
      throw new Error(errorMessage);
    },
    stop: async () => {},
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("TaskRunner — adversarial tests", () => {
  let runsDir: string;
  let workspaceDir: string;
  let runManager: RunManager;
  let sessionManager: SessionManager;

  beforeEach(() => {
    runsDir = fs.mkdtempSync(path.join(os.tmpdir(), "codebridge-adv-runs-"));
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "codebridge-adv-ws-"));
    runManager = new RunManager(runsDir);
    sessionManager = new SessionManager(runManager);
  });

  afterEach(() => {
    fs.rmSync(runsDir, { recursive: true, force: true });
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // ADVERSARIAL TEST 1
  // Security: symlink inside allowed_root pointing outside should be rejected
  //
  // path.resolve() resolves the symlink path STRING but does NOT follow
  // the symlink on disk.  fs.realpathSync() is the correct call.
  // A symlink at /allowed/workspace -> /etc would pass the current check.
  // -------------------------------------------------------------------------
  it("rejects symlink workspace that resolves outside allowed_roots", async () => {
    // Create a symlink inside workspaceDir that points to a sibling directory
    const escapedDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "codebridge-escaped-"),
    );
    const symlinkPath = path.join(workspaceDir, "link-to-outside");
    try {
      fs.symlinkSync(escapedDir, symlinkPath);

      const runner = new TaskRunner(
        runManager,
        sessionManager,
        makeSuccessEngine(),
      );
      const runId = await runManager.createRun({
        task_id: "task-symlink",
        intent: "coding",
        workspace_path: symlinkPath, // points outside workspaceDir
        message: "Symlink escape",
        engine: "claude-code",
        mode: "new",
        allowed_roots: [workspaceDir],
      });

      await runner.processRun(runId);

      const resultPath = path.join(runsDir, runId, "result.json");
      const result = JSON.parse(fs.readFileSync(resultPath, "utf-8"));
      // The symlink string path starts with workspaceDir, so path.resolve()
      // will happily pass the prefix check — but the real destination is outside.
      expect(result.error?.code).toBe("WORKSPACE_INVALID");
    } finally {
      fs.rmSync(escapedDir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // ADVERSARIAL TEST 2
  // Schema: resume mode with null session_id should be rejected
  //
  // The RequestSchema allows session_id: null (default).  When mode="resume"
  // and session_id is null, runner.ts falls through to engine.start() instead
  // of engine.send() because `request.session_id` is falsy.  This silently
  // starts a NEW task instead of resuming — a logic error.
  // -------------------------------------------------------------------------
  it("rejects resume mode when session_id is null", async () => {
    const runner = new TaskRunner(
      runManager,
      sessionManager,
      makeSuccessEngine(),
    );
    const runId = await runManager.createRun({
      task_id: "task-resume-null",
      intent: "coding",
      workspace_path: workspaceDir,
      message: "Resume without session id",
      engine: "claude-code",
      mode: "resume",
      session_id: null, // explicitly null
    });

    await runner.processRun(runId);

    const resultPath = path.join(runsDir, runId, "result.json");
    const result = JSON.parse(fs.readFileSync(resultPath, "utf-8"));
    // Expect the runner to reject resume-with-no-session_id rather than
    // silently treating it as a new task.
    expect(result.status).toBe("failed");
    expect(result.error.code).toBe("REQUEST_INVALID");
  });

  // -------------------------------------------------------------------------
  // ADVERSARIAL TEST 3
  // State machine: engine throws synchronously — session should reach "failed"
  //
  // If engine.start() throws (rather than returning an error result),
  // the unhandled exception propagates up through processRun's async IIFE.
  // The fail() path is never reached and session stays in "running" state
  // indefinitely, with no result.json written.
  // -------------------------------------------------------------------------
  it("writes failed result.json when engine.start throws synchronously", async () => {
    const runner = new TaskRunner(
      runManager,
      sessionManager,
      makeThrowingEngine("uncaught engine exception"),
    );
    const runId = await runManager.createRun({
      task_id: "task-throw",
      intent: "coding",
      workspace_path: workspaceDir,
      message: "Throw in engine",
      engine: "claude-code",
      mode: "new",
    });

    // processRun should NOT throw — it should catch and write a failed result
    await expect(runner.processRun(runId)).resolves.not.toThrow();

    const resultPath = path.join(runsDir, runId, "result.json");
    expect(fs.existsSync(resultPath)).toBe(true);
    const result = JSON.parse(fs.readFileSync(resultPath, "utf-8"));
    expect(result.status).toBe("failed");

    const session = await sessionManager.getSession(runId);
    expect(session.state).toBe("failed");
  });

  // -------------------------------------------------------------------------
  // ADVERSARIAL TEST 4
  // State machine: sessionManager.transition("completed") throws after
  // writeOutputFile succeeds — result.json is never written, leaving
  // output.txt orphaned without a completion signal.
  // -------------------------------------------------------------------------
  it("writes result.json even when sessionManager.transition to completed throws", async () => {
    const runner = new TaskRunner(
      runManager,
      sessionManager,
      makeSuccessEngine("some output"),
    );
    const runId = await runManager.createRun({
      task_id: "task-transition-throw",
      intent: "coding",
      workspace_path: workspaceDir,
      message: "Transition throw",
      engine: "claude-code",
      mode: "new",
    });

    // Patch sessionManager to throw on "completed" transition
    const origTransition = sessionManager.transition.bind(sessionManager);
    sessionManager.transition = async (id, newState, updates?) => {
      if (newState === "completed") {
        throw new Error("DB unavailable during completed transition");
      }
      return origTransition(id, newState, updates);
    };

    await runner.processRun(runId);

    // Restore
    sessionManager.transition = origTransition;

    const resultPath = path.join(runsDir, runId, "result.json");
    // Bug: if transition("completed") throws and is not caught,
    // result.json will be missing and the caller hangs/crashes.
    expect(fs.existsSync(resultPath)).toBe(true);
    const result = JSON.parse(fs.readFileSync(resultPath, "utf-8"));
    expect(result.status).not.toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // ADVERSARIAL TEST 5
  // Concurrent processRun: calling processRun twice for the same runId
  // should be idempotent — the second call should fail gracefully, not panic.
  //
  // consumeRequest() is atomic (rename), so the second caller gets null.
  // The current code then calls fail() which calls getSession/transition.
  // If the first call is still running (running state), the second fail()
  // attempts transition(runId, "running") from "running" (invalid) or
  // races to overwrite result.json.
  // -------------------------------------------------------------------------
  it("second concurrent processRun for same runId does not overwrite completed result", async () => {
    // Use a slow engine to increase concurrency window
    let resolveEngine!: (r: EngineResponse) => void;
    const enginePromise = new Promise<EngineResponse>((resolve) => {
      resolveEngine = resolve;
    });
    const slowEngine: Engine = {
      start: () => enginePromise,
      send: () => enginePromise,
      stop: async () => {},
    };

    const runner = new TaskRunner(runManager, sessionManager, slowEngine);
    const runId = await runManager.createRun({
      task_id: "task-concurrent",
      intent: "coding",
      workspace_path: workspaceDir,
      message: "Concurrent test",
      engine: "claude-code",
      mode: "new",
    });

    // Start first processRun (will block waiting for engine)
    const first = runner.processRun(runId);

    // Start second processRun immediately (request.json already renamed)
    const second = runner.processRun(runId);

    // Resolve the engine so first run can complete
    resolveEngine({
      output: "completed output",
      pid: 999,
      exitCode: 0,
      sessionId: "sess-1",
    });

    await Promise.all([first, second]);

    const resultPath = path.join(runsDir, runId, "result.json");
    expect(fs.existsSync(resultPath)).toBe(true);
    const result = JSON.parse(fs.readFileSync(resultPath, "utf-8"));
    // The first run should win; result should be "completed"
    // Bug candidate: second run's fail() writes "failed" OVER the completed result
    expect(result.status).toBe("completed");
  });

  // -------------------------------------------------------------------------
  // ADVERSARIAL TEST 6
  // Workspace is a file, not a directory
  //
  // The WORKSPACE_NOT_FOUND error is also triggered when the path is a file.
  // This test confirms the error code and that the engine is NOT invoked.
  // -------------------------------------------------------------------------
  it("rejects workspace path that points to a file rather than a directory", async () => {
    const filePath = path.join(workspaceDir, "not-a-dir.txt");
    fs.writeFileSync(filePath, "I am a file");

    const runner = new TaskRunner(
      runManager,
      sessionManager,
      makeSuccessEngine(),
    );
    const runId = await runManager.createRun({
      task_id: "task-file-ws",
      intent: "coding",
      workspace_path: filePath,
      message: "Workspace is a file",
      engine: "claude-code",
      mode: "new",
    });

    await runner.processRun(runId);

    const result = JSON.parse(
      fs.readFileSync(path.join(runsDir, runId, "result.json"), "utf-8"),
    );
    expect(result.error.code).toBe("WORKSPACE_NOT_FOUND");
    expect(result.status).toBe("failed");
  });

  // -------------------------------------------------------------------------
  // ADVERSARIAL TEST 7
  // Schema validation: empty task_id should be rejected
  //
  // task_id: z.string().min(1) — an empty string "" should fail validation.
  // -------------------------------------------------------------------------
  it("rejects request with empty task_id", async () => {
    const runner = new TaskRunner(
      runManager,
      sessionManager,
      makeSuccessEngine(),
    );
    const runId = await runManager.createRun({
      task_id: "placeholder", // createRun doesn't validate — we'll patch the file
      intent: "coding",
      workspace_path: workspaceDir,
      message: "Test",
      engine: "claude-code",
      mode: "new",
    });

    // Overwrite request.json with an empty task_id
    const runDir = path.join(runsDir, runId);
    const requestPath = path.join(runDir, "request.json");
    const existing = JSON.parse(fs.readFileSync(requestPath, "utf-8"));
    fs.writeFileSync(requestPath, JSON.stringify({ ...existing, task_id: "" }));

    await runner.processRun(runId);

    const result = JSON.parse(
      fs.readFileSync(path.join(runDir, "result.json"), "utf-8"),
    );
    expect(result.error.code).toBe("REQUEST_INVALID");
    expect(result.status).toBe("failed");
  });

  // -------------------------------------------------------------------------
  // ADVERSARIAL TEST 8
  // Schema validation: empty message should be rejected
  //
  // message: z.string().min(1) — an empty string "" should fail.
  // -------------------------------------------------------------------------
  it("rejects request with empty message", async () => {
    const runner = new TaskRunner(
      runManager,
      sessionManager,
      makeSuccessEngine(),
    );
    const runId = await runManager.createRun({
      task_id: "task-empty-msg",
      intent: "coding",
      workspace_path: workspaceDir,
      message: "placeholder",
      engine: "claude-code",
      mode: "new",
    });

    const runDir = path.join(runsDir, runId);
    const requestPath = path.join(runDir, "request.json");
    const existing = JSON.parse(fs.readFileSync(requestPath, "utf-8"));
    fs.writeFileSync(requestPath, JSON.stringify({ ...existing, message: "" }));

    await runner.processRun(runId);

    const result = JSON.parse(
      fs.readFileSync(path.join(runDir, "result.json"), "utf-8"),
    );
    expect(result.error.code).toBe("REQUEST_INVALID");
    expect(result.status).toBe("failed");
  });

  // -------------------------------------------------------------------------
  // ADVERSARIAL TEST 9
  // Schema validation: unknown/invalid intent should be rejected
  //
  // intent: z.enum(['coding', 'refactor', 'debug', 'ops'])
  // -------------------------------------------------------------------------
  it("rejects request with invalid intent value", async () => {
    const runner = new TaskRunner(
      runManager,
      sessionManager,
      makeSuccessEngine(),
    );
    const runId = await runManager.createRun({
      task_id: "task-bad-intent",
      intent: "coding",
      workspace_path: workspaceDir,
      message: "Test",
      engine: "claude-code",
      mode: "new",
    });

    const runDir = path.join(runsDir, runId);
    const requestPath = path.join(runDir, "request.json");
    const existing = JSON.parse(fs.readFileSync(requestPath, "utf-8"));
    fs.writeFileSync(
      requestPath,
      JSON.stringify({ ...existing, intent: "hacking" }),
    );

    await runner.processRun(runId);

    const result = JSON.parse(
      fs.readFileSync(path.join(runDir, "result.json"), "utf-8"),
    );
    expect(result.error.code).toBe("REQUEST_INVALID");
  });

  // -------------------------------------------------------------------------
  // ADVERSARIAL TEST 10
  // Schema validation: workspace_path that is one of the DANGEROUS_ROOTS
  // (/etc) should be rejected via schema, not runner logic.
  //
  // The schema has its own DANGEROUS_ROOTS list that is checked independently
  // from the runner's allowed_roots logic — but only if /etc actually exists.
  // -------------------------------------------------------------------------
  it("rejects workspace_path of /etc via schema validation", async () => {
    // Skip on systems where /etc doesn't exist
    if (!fs.existsSync("/etc")) return;

    const runner = new TaskRunner(
      runManager,
      sessionManager,
      makeSuccessEngine(),
    );
    const runId = await runManager.createRun({
      task_id: "task-etc",
      intent: "coding",
      workspace_path: workspaceDir, // valid for createRun
      message: "Test /etc",
      engine: "claude-code",
      mode: "new",
    });

    // Overwrite request.json with /etc as workspace
    const runDir = path.join(runsDir, runId);
    const requestPath = path.join(runDir, "request.json");
    const existing = JSON.parse(fs.readFileSync(requestPath, "utf-8"));
    fs.writeFileSync(
      requestPath,
      JSON.stringify({ ...existing, workspace_path: "/etc" }),
    );

    await runner.processRun(runId);

    const result = JSON.parse(
      fs.readFileSync(path.join(runDir, "result.json"), "utf-8"),
    );
    expect(result.error.code).toBe("REQUEST_INVALID");
  });

  // -------------------------------------------------------------------------
  // ADVERSARIAL TEST 11
  // pid guard: engine returns pid=0 (falsy) — session never gets pid updated
  //
  // runner.ts line 121: `if (engineResponse.pid)` — pid=0 is falsy in JS.
  // Real processes can have pid=0 in edge cases, and the base engine uses
  // `child.pid ?? 0` as the fallback — so pid=0 IS a plausible value.
  // When pid=0, the updateSession call is skipped silently.
  // -------------------------------------------------------------------------
  it("still writes result.json when engine returns pid=0", async () => {
    const zeroPidEngine: Engine = {
      start: async () => ({
        output: "zero pid output",
        pid: 0, // falsy — triggers the bug
        exitCode: 0,
        sessionId: "sess-zero",
      }),
      send: async () => ({
        output: "zero pid output",
        pid: 0,
        exitCode: 0,
        sessionId: "sess-zero",
      }),
      stop: async () => {},
    };

    const runner = new TaskRunner(runManager, sessionManager, zeroPidEngine);
    const runId = await runManager.createRun({
      task_id: "task-zero-pid",
      intent: "coding",
      workspace_path: workspaceDir,
      message: "Zero pid",
      engine: "claude-code",
      mode: "new",
    });

    await runner.processRun(runId);

    const result = JSON.parse(
      fs.readFileSync(path.join(runsDir, runId, "result.json"), "utf-8"),
    );
    // Should still complete successfully even with pid=0
    expect(result.status).toBe("completed");
    // pid should NOT be written to session since guard skips it
    // (This documents the behaviour, not asserts the bug is fixed)
    const session = await sessionManager.getSession(runId);
    expect(session.state).toBe("completed");
  });

  // -------------------------------------------------------------------------
  // ADVERSARIAL TEST 12
  // summary_truncated boundary: exactly 3999 chars should NOT truncate
  // -------------------------------------------------------------------------
  it("does not truncate summary at exactly 3999 chars", async () => {
    const output3999 = "X".repeat(3999);
    const engine = makeSuccessEngine(output3999);
    const runner = new TaskRunner(runManager, sessionManager, engine);
    const runId = await runManager.createRun({
      task_id: "task-3999",
      intent: "coding",
      workspace_path: workspaceDir,
      message: "Test 3999",
      engine: "claude-code",
      mode: "new",
    });

    await runner.processRun(runId);

    const result = JSON.parse(
      fs.readFileSync(path.join(runsDir, runId, "result.json"), "utf-8"),
    );
    expect(result.summary.length).toBe(3999);
    expect(result.summary_truncated).toBe(false);
  });

  // -------------------------------------------------------------------------
  // ADVERSARIAL TEST 13
  // output_path field in failed result when session transitions to running
  // but engine result has error — output_path must be null
  // -------------------------------------------------------------------------
  it("result.output_path is null when engine returns an error response", async () => {
    const runner = new TaskRunner(
      runManager,
      sessionManager,
      makeErrorEngine("ENGINE_CRASH", "engine died"),
    );
    const runId = await runManager.createRun({
      task_id: "task-engine-err",
      intent: "coding",
      workspace_path: workspaceDir,
      message: "Engine error",
      engine: "claude-code",
      mode: "new",
    });

    await runner.processRun(runId);

    const result = JSON.parse(
      fs.readFileSync(path.join(runsDir, runId, "result.json"), "utf-8"),
    );
    expect(result.status).toBe("failed");
    expect(result.output_path).toBeNull();
    // output.txt must NOT exist
    const outputPath = path.join(runsDir, runId, "output.txt");
    expect(fs.existsSync(outputPath)).toBe(false);
  });

  // -------------------------------------------------------------------------
  // ADVERSARIAL TEST 14
  // fail() called from "stopping" state — must still write result.json
  //
  // VALID_TRANSITIONS allows stopping -> failed.  If a task is stopped while
  // running and the engine returns an error, fail() must navigate the
  // stopping -> failed transition without throwing.
  // -------------------------------------------------------------------------
  it("writes failed result.json when session is in stopping state at fail time", async () => {
    // Engine returns an error response
    const engine = makeErrorEngine("ENGINE_CRASH", "stopped mid-run");
    const runner = new TaskRunner(runManager, sessionManager, engine);
    const runId = await runManager.createRun({
      task_id: "task-stopping",
      intent: "coding",
      workspace_path: workspaceDir,
      message: "Stopping test",
      engine: "claude-code",
      mode: "new",
    });

    // Manually advance state to "stopping" (simulate external stop command)
    // First transition to running manually so we can then go to stopping
    await sessionManager.transition(runId, "running");
    await sessionManager.transition(runId, "stopping");

    // processRun will try to transition to running again (from "stopping")
    // This will throw an invalid transition error and the run will fail to
    // even start — which is actually a valid outcome, but the result.json
    // must still be written.
    await runner.processRun(runId);

    const resultPath = path.join(runsDir, runId, "result.json");
    expect(fs.existsSync(resultPath)).toBe(true);
    const result = JSON.parse(fs.readFileSync(resultPath, "utf-8"));
    expect(result.status).toBe("failed");
  });

  // -------------------------------------------------------------------------
  // ADVERSARIAL TEST 15
  // getFilesChanged: git repo with no commits yet (no HEAD ref)
  //
  // `git diff --name-only HEAD` fails with "fatal: ambiguous argument 'HEAD'"
  // on a fresh repo with no commits.  The catch returns null — but the
  // second execSync call `git ls-files --others` would succeed.
  // The two-command approach means one can succeed while the other fails,
  // and the catch collapses both into null regardless.
  // This test verifies the result is null rather than crashing.
  // -------------------------------------------------------------------------
  it("sets files_changed to null for git repo with no commits (no HEAD)", async () => {
    // Init a fresh git repo with no commits
    execSync(
      'git init && git config user.email "t@t.com" && git config user.name "T"',
      { cwd: workspaceDir },
    );
    // Do NOT commit anything — no HEAD exists

    const engine = makeSuccessEngine("output");
    const runner = new TaskRunner(runManager, sessionManager, engine);
    const runId = await runManager.createRun({
      task_id: "task-nohead",
      intent: "coding",
      workspace_path: workspaceDir,
      message: "No HEAD",
      engine: "claude-code",
      mode: "new",
    });

    await runner.processRun(runId);

    const result = JSON.parse(
      fs.readFileSync(path.join(runsDir, runId, "result.json"), "utf-8"),
    );
    expect(result.status).toBe("completed");
    // files_changed must be null because git diff HEAD fails on empty repo
    expect(result.files_changed).toBeNull();
  });

  // -------------------------------------------------------------------------
  // ADVERSARIAL TEST 16
  // allowed_roots with trailing slash — path normalization edge case
  //
  // allowed_roots: ["/home/user/"] should be treated equivalently to
  // ["/home/user"].  path.resolve strips the trailing slash, so this
  // should work.  Test explicitly covers the trailing-slash case.
  // -------------------------------------------------------------------------
  it("accepts workspace within allowed_root that has trailing slash", async () => {
    const subDir = path.join(workspaceDir, "sub");
    fs.mkdirSync(subDir);

    const runner = new TaskRunner(
      runManager,
      sessionManager,
      makeSuccessEngine(),
    );
    const runId = await runManager.createRun({
      task_id: "task-trailing",
      intent: "coding",
      workspace_path: subDir,
      message: "Trailing slash test",
      engine: "claude-code",
      mode: "new",
      allowed_roots: [workspaceDir + "/"], // trailing slash
    });

    await runner.processRun(runId);

    const result = JSON.parse(
      fs.readFileSync(path.join(runsDir, runId, "result.json"), "utf-8"),
    );
    expect(result.status).toBe("completed");
  });

  // -------------------------------------------------------------------------
  // ADVERSARIAL TEST 17
  // allowed_roots exact-match: workspace === allowed_root (not just subtree)
  //
  // The check:
  //   resolvedWorkspace === resolvedRoot || resolvedWorkspace.startsWith(resolvedRoot + sep)
  // Both branches must work.  Existing tests only cover the startsWith branch.
  // -------------------------------------------------------------------------
  it("accepts workspace that exactly equals an allowed_root", async () => {
    const runner = new TaskRunner(
      runManager,
      sessionManager,
      makeSuccessEngine(),
    );
    const runId = await runManager.createRun({
      task_id: "task-exact-root",
      intent: "coding",
      workspace_path: workspaceDir,
      message: "Exact root match",
      engine: "claude-code",
      mode: "new",
      allowed_roots: [workspaceDir],
    });

    await runner.processRun(runId);

    const result = JSON.parse(
      fs.readFileSync(path.join(runsDir, runId, "result.json"), "utf-8"),
    );
    expect(result.status).toBe("completed");
  });

  // -------------------------------------------------------------------------
  // ADVERSARIAL TEST 18
  // result.json session_id field: engine sessionId=null should produce
  // session_id: null in result (not undefined, not "null" string)
  // -------------------------------------------------------------------------
  it("result.session_id is null (not undefined) when engine returns null sessionId", async () => {
    const nullSessionEngine: Engine = {
      start: async () => ({
        output: "hi",
        pid: 1,
        exitCode: 0,
        sessionId: null,
      }),
      send: async () => ({
        output: "hi",
        pid: 1,
        exitCode: 0,
        sessionId: null,
      }),
      stop: async () => {},
    };

    const runner = new TaskRunner(
      runManager,
      sessionManager,
      nullSessionEngine,
    );
    const runId = await runManager.createRun({
      task_id: "task-null-sess",
      intent: "coding",
      workspace_path: workspaceDir,
      message: "Null session",
      engine: "claude-code",
      mode: "new",
    });

    await runner.processRun(runId);

    const result = JSON.parse(
      fs.readFileSync(path.join(runsDir, runId, "result.json"), "utf-8"),
    );
    expect(result.status).toBe("completed");
    expect(result.session_id).toBeNull();
    expect(result.session_id).not.toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // ADVERSARIAL TEST 19
  // Resolver function support: EngineResolver that throws for unknown engine
  // should produce a failed result, not an unhandled exception in processRun
  // -------------------------------------------------------------------------
  it("writes failed result when engineResolver throws for unknown engine name", async () => {
    const throwingResolver: EngineResolver = (name: string) => {
      throw new Error(`Unknown engine: ${name}`);
    };

    const runner = new TaskRunner(runManager, sessionManager, throwingResolver);
    const runId = await runManager.createRun({
      task_id: "task-bad-engine",
      intent: "coding",
      workspace_path: workspaceDir,
      message: "Bad engine resolver",
      engine: "claude-code",
      mode: "new",
    });

    await expect(runner.processRun(runId)).resolves.not.toThrow();

    const resultPath = path.join(runsDir, runId, "result.json");
    expect(fs.existsSync(resultPath)).toBe(true);
    const result = JSON.parse(fs.readFileSync(resultPath, "utf-8"));
    expect(result.status).toBe("failed");
  });

  // -------------------------------------------------------------------------
  // ADVERSARIAL TEST 20
  // Output file: binary-like content (null bytes, control chars) in output
  // should not crash writeOutputFile or corrupt result.json
  // -------------------------------------------------------------------------
  it("handles binary-like output content without crashing", async () => {
    // Construct a string with null bytes and control characters
    const binaryLikeOutput = "start\x00\x01\x02\x03\xff\xfe end";
    const binaryEngine: Engine = {
      start: async () => ({
        output: binaryLikeOutput,
        pid: 42,
        exitCode: 0,
        sessionId: null,
      }),
      send: async () => ({
        output: binaryLikeOutput,
        pid: 42,
        exitCode: 0,
        sessionId: null,
      }),
      stop: async () => {},
    };

    const runner = new TaskRunner(runManager, sessionManager, binaryEngine);
    const runId = await runManager.createRun({
      task_id: "task-binary",
      intent: "coding",
      workspace_path: workspaceDir,
      message: "Binary output",
      engine: "claude-code",
      mode: "new",
    });

    await runner.processRun(runId);

    const result = JSON.parse(
      fs.readFileSync(path.join(runsDir, runId, "result.json"), "utf-8"),
    );
    expect(result.status).toBe("completed");
    const outputPath = path.join(runsDir, runId, "output.txt");
    expect(fs.existsSync(outputPath)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // ADVERSARIAL TEST 21
  // allowed_roots: multiple roots — workspace should match ANY of them
  // -------------------------------------------------------------------------
  it("accepts workspace matching the second of multiple allowed_roots", async () => {
    const altRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codebridge-alt-"));
    const subInAlt = path.join(altRoot, "sub");
    fs.mkdirSync(subInAlt);
    try {
      const runner = new TaskRunner(
        runManager,
        sessionManager,
        makeSuccessEngine(),
      );
      const runId = await runManager.createRun({
        task_id: "task-multi-root",
        intent: "coding",
        workspace_path: subInAlt,
        message: "Multi root",
        engine: "claude-code",
        mode: "new",
        allowed_roots: [workspaceDir, altRoot], // workspace is under altRoot
      });

      await runner.processRun(runId);

      const result = JSON.parse(
        fs.readFileSync(path.join(runsDir, runId, "result.json"), "utf-8"),
      );
      expect(result.status).toBe("completed");
    } finally {
      fs.rmSync(altRoot, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // ADVERSARIAL TEST 22
  // Request JSON that is structurally valid JSON but missing required fields
  // (e.g., no workspace_path at all) should fail with REQUEST_INVALID.
  // -------------------------------------------------------------------------
  it("rejects request.json missing required workspace_path field", async () => {
    const runner = new TaskRunner(
      runManager,
      sessionManager,
      makeSuccessEngine(),
    );
    const runId = await runManager.createRun({
      task_id: "task-missing-ws",
      intent: "coding",
      workspace_path: workspaceDir,
      message: "Test",
      engine: "claude-code",
      mode: "new",
    });

    const runDir = path.join(runsDir, runId);
    const requestPath = path.join(runDir, "request.json");
    const existing = JSON.parse(fs.readFileSync(requestPath, "utf-8"));
    // Delete workspace_path
    delete existing.workspace_path;
    fs.writeFileSync(requestPath, JSON.stringify(existing));

    await runner.processRun(runId);

    const result = JSON.parse(
      fs.readFileSync(path.join(runDir, "result.json"), "utf-8"),
    );
    expect(result.error.code).toBe("REQUEST_INVALID");
  });

  // -------------------------------------------------------------------------
  // ADVERSARIAL TEST 23
  // Request JSON that is not valid JSON at all — consumeRequest will throw
  // JSON.parse error.  processRun should handle this and write a failed result.
  // -------------------------------------------------------------------------
  it("writes failed result when request.json contains invalid JSON", async () => {
    const runner = new TaskRunner(
      runManager,
      sessionManager,
      makeSuccessEngine(),
    );
    const runId = await runManager.createRun({
      task_id: "task-bad-json",
      intent: "coding",
      workspace_path: workspaceDir,
      message: "Test",
      engine: "claude-code",
      mode: "new",
    });

    // Overwrite request.json with garbage
    const runDir = path.join(runsDir, runId);
    fs.writeFileSync(path.join(runDir, "request.json"), "{ not valid json !!!");

    await expect(runner.processRun(runId)).resolves.not.toThrow();

    const resultPath = path.join(runDir, "result.json");
    // Bug candidate: JSON.parse throws inside consumeRequest, propagates up
    // as unhandled rejection rather than a written failed result
    expect(fs.existsSync(resultPath)).toBe(true);
    const result = JSON.parse(fs.readFileSync(resultPath, "utf-8"));
    expect(result.status).toBe("failed");
  });
});

/**
 * BDD security tests for issue #20: path traversal and workspace validation bypasses.
 *
 * Each describe block follows Given-When-Then structure to document
 * the security invariant being enforced, then verifies it.
 *
 * All tests in this file are written before the implementation fixes
 * (TDD/BDD red-green cycle).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { RunManager } from "../../src/core/run-manager.js";
import { validateRequest } from "../../src/schemas/request.js";
import { validateResult } from "../../src/schemas/result.js";
import { TaskRunner } from "../../src/core/runner.js";
import { SessionManager } from "../../src/core/session-manager.js";
import { ClaudeCodeEngine } from "../../src/engines/claude-code.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeManager() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codebridge-sec20-"));
  return { dir, manager: new RunManager(dir) };
}

const validBase = {
  task_id: "task-sec20",
  intent: "coding" as const,
  workspace_path: "/home/user/project",
  message: "Security test",
};

// ===========================================================================
// Bug 1 (HIGH): Symlink workspace bypasses `allowed_roots`
// ===========================================================================
// Given: A symlink inside an allowed root that points outside the allowed root
// When:  TaskRunner validates the workspace path against allowed_roots
// Then:  The request must be rejected with WORKSPACE_INVALID
//        (because fs.realpathSync resolves the symlink to its real target)
// ===========================================================================

describe("Bug 1 – symlink workspace bypasses allowed_roots", () => {
  let runsDir: string;
  let runManager: RunManager;
  let sessionManager: SessionManager;
  let allowedDir: string;
  let outsideDir: string;
  let symlinkInAllowed: string;

  beforeEach(() => {
    runsDir = fs.mkdtempSync(path.join(os.tmpdir(), "codebridge-sec20-runs-"));
    allowedDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "codebridge-sec20-allowed-"),
    );
    outsideDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "codebridge-sec20-outside-"),
    );
    // Create a symlink inside allowedDir pointing to outsideDir
    symlinkInAllowed = path.join(allowedDir, "sneaky-link");
    fs.symlinkSync(outsideDir, symlinkInAllowed);
    runManager = new RunManager(runsDir);
    sessionManager = new SessionManager(runManager);
  });

  afterEach(() => {
    fs.rmSync(runsDir, { recursive: true, force: true });
    fs.rmSync(allowedDir, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  });

  it("rejects a workspace that is a symlink pointing outside allowed_roots", async () => {
    // Given: symlinkInAllowed looks lexically inside allowedDir
    //        but physically resolves to outsideDir
    // When:  TaskRunner.processRun() is called with workspace = symlink
    // Then:  result.status === 'failed' and error.code === 'WORKSPACE_INVALID'
    const engine = new ClaudeCodeEngine({
      command: "echo",
      defaultArgs: ["should not run"],
    });
    const runner = new TaskRunner(runManager, sessionManager, engine);
    const runId = await runManager.createRun({
      task_id: "task-symlink",
      intent: "coding",
      workspace_path: symlinkInAllowed,
      message: "Symlink traversal",
      engine: "claude-code",
      mode: "new",
      allowed_roots: [allowedDir],
    });

    await runner.processRun(runId);

    const resultPath = path.join(runsDir, runId, "result.json");
    const result = JSON.parse(fs.readFileSync(resultPath, "utf-8"));
    expect(result.status).toBe("failed");
    expect(result.error.code).toBe("WORKSPACE_INVALID");
  });

  it("accepts a workspace that is a symlink pointing inside allowed_roots", async () => {
    // Given: a symlink inside allowedDir that points to a subdirectory of allowedDir
    // When:  TaskRunner.processRun() is called
    // Then:  the run completes successfully (symlink target is still within allowed_roots)
    const innerDir = fs.mkdtempSync(path.join(allowedDir, "inner-"));
    const goodSymlink = path.join(allowedDir, "good-link");
    fs.symlinkSync(innerDir, goodSymlink);

    const engine = new ClaudeCodeEngine({
      command: "echo",
      defaultArgs: ["ok"],
    });
    const runner = new TaskRunner(runManager, sessionManager, engine);
    const runId = await runManager.createRun({
      task_id: "task-good-symlink",
      intent: "coding",
      workspace_path: goodSymlink,
      message: "Good symlink",
      engine: "claude-code",
      mode: "new",
      allowed_roots: [allowedDir],
    });

    await runner.processRun(runId);

    const resultPath = path.join(runsDir, runId, "result.json");
    const result = JSON.parse(fs.readFileSync(resultPath, "utf-8"));
    expect(result.status).toBe("completed");
  });

  it("returns WORKSPACE_NOT_FOUND when symlink target does not exist", async () => {
    // Given: a symlink that points to a non-existent path
    // When:  TaskRunner.processRun() is called
    // Then:  fs.realpathSync throws ENOENT → runner catches it and fails with
    //        WORKSPACE_NOT_FOUND (path cannot be resolved)
    const danglingLink = path.join(allowedDir, "dangling");
    fs.symlinkSync("/nonexistent/target/12345", danglingLink);

    const engine = new ClaudeCodeEngine({
      command: "echo",
      defaultArgs: ["should not run"],
    });
    const runner = new TaskRunner(runManager, sessionManager, engine);
    const runId = await runManager.createRun({
      task_id: "task-dangling",
      intent: "coding",
      workspace_path: danglingLink,
      message: "Dangling symlink",
      engine: "claude-code",
      mode: "new",
      allowed_roots: [allowedDir],
    });

    await runner.processRun(runId);

    const resultPath = path.join(runsDir, runId, "result.json");
    const result = JSON.parse(fs.readFileSync(resultPath, "utf-8"));
    expect(result.status).toBe("failed");
    // A non-resolvable path should fail, either WORKSPACE_NOT_FOUND or WORKSPACE_INVALID
    expect(["WORKSPACE_NOT_FOUND", "WORKSPACE_INVALID"]).toContain(
      result.error.code,
    );
  });
});

// ===========================================================================
// Bug 2 (HIGH): Path traversal in run IDs
// ===========================================================================
// Given: A malicious run ID containing '..' path segments
// When:  RunManager.getRunDir(runId) is called
// Then:  The returned path must remain inside this.runsDir
// ===========================================================================

describe("Bug 2 – path traversal in run IDs", () => {
  let runsDir: string;
  let manager: RunManager;

  beforeEach(() => {
    const m = makeManager();
    runsDir = m.dir;
    manager = m.manager;
  });

  afterEach(() => {
    fs.rmSync(runsDir, { recursive: true, force: true });
  });

  it("getRunDir throws or stays inside runsDir when runId contains '..'", () => {
    // Given: a crafted runId with parent-directory traversal segments
    // When:  getRunDir() is called
    // Then:  the returned path starts with runsDir (no escape) OR throws an error
    const maliciousRunId = "../../etc/passwd";
    let result: string;
    try {
      result = manager.getRunDir(maliciousRunId);
    } catch {
      // Throwing is also acceptable — means the traversal was caught
      return;
    }
    expect(result!.startsWith(runsDir)).toBe(true);
  });

  it("getRunDir throws or stays inside runsDir when runId contains multiple '..' segments", () => {
    // Given: a deeper traversal attempt
    // When:  getRunDir() is called
    // Then:  stays inside runsDir or throws
    const deepTraversal = "../../../../../../../tmp/escape";
    let result: string;
    try {
      result = manager.getRunDir(deepTraversal);
    } catch {
      return;
    }
    expect(result!.startsWith(runsDir)).toBe(true);
  });

  it("getRunDir with a valid run-<id> format stays inside runsDir", () => {
    // Given: a well-formed run ID
    // When:  getRunDir() is called
    // Then:  the returned path is exactly runsDir/<runId>
    const validRunId = "run-abc123XYZ456";
    const result = manager.getRunDir(validRunId);
    expect(result).toBe(path.join(runsDir, validRunId));
    expect(result.startsWith(runsDir)).toBe(true);
  });

  it("getRunDir with absolute path runId does not escape runsDir", () => {
    // Given: a runId that is an absolute path
    // When:  getRunDir() is called
    // Then:  the result does not become exactly the injected path
    const absoluteRunId = "/tmp/injected-run";
    let result: string;
    try {
      result = manager.getRunDir(absoluteRunId);
    } catch {
      return;
    }
    expect(result).not.toBe("/tmp/injected-run");
  });
});

// ===========================================================================
// Bug 3 (HIGH): DANGEROUS_ROOTS only blocks exact matches
// ===========================================================================
// Given: A workspace_path that is a subdirectory of a dangerous root
//        (e.g. /etc/passwd, /usr/bin, /var/run/secrets)
// When:  validateRequest() is called
// Then:  validation fails with 'Workspace path is a disallowed root path'
// ===========================================================================

describe("Bug 3 – DANGEROUS_ROOTS blocks sub-paths of dangerous roots", () => {
  it("rejects /etc/passwd (sub-path of blocked /etc)", () => {
    // Given: workspace_path resolves to /etc/passwd
    // When:  validateRequest() is called
    // Then:  success === false, message includes disallowed root
    const result = validateRequest({
      ...validBase,
      workspace_path: "/etc/passwd",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map(
        (i: { message: string }) => i.message,
      );
      expect(messages.some((m) => m.includes("disallowed"))).toBe(true);
    }
  });

  it("rejects /etc/sudoers (sub-path of blocked /etc)", () => {
    const result = validateRequest({
      ...validBase,
      workspace_path: "/etc/sudoers",
    });
    expect(result.success).toBe(false);
  });

  it("rejects /usr/bin (sub-path of blocked /usr)", () => {
    // Given: workspace_path resolves to /usr/bin
    // When:  validateRequest() is called
    // Then:  success === false
    const result = validateRequest({
      ...validBase,
      workspace_path: "/usr/bin",
    });
    expect(result.success).toBe(false);
  });

  it("rejects /usr/local/bin (deep sub-path of blocked /usr)", () => {
    const result = validateRequest({
      ...validBase,
      workspace_path: "/usr/local/bin",
    });
    expect(result.success).toBe(false);
  });

  it("rejects /var/run (a specific dangerous /var sub-path)", () => {
    // Given: workspace_path resolves to /var/run (system runtime directory)
    // When:  validateRequest() is called
    // Then:  success === false
    const result = validateRequest({
      ...validBase,
      workspace_path: "/var/run",
    });
    expect(result.success).toBe(false);
  });

  it("rejects /var/run/secrets (sub-path of blocked /var/run)", () => {
    // Given: workspace_path resolves to /var/run/secrets
    // When:  validateRequest() is called
    // Then:  success === false
    const result = validateRequest({
      ...validBase,
      workspace_path: "/var/run/secrets",
    });
    expect(result.success).toBe(false);
  });

  it("rejects /bin/sh (sub-path of blocked /bin)", () => {
    const result = validateRequest({
      ...validBase,
      workspace_path: "/bin/sh",
    });
    expect(result.success).toBe(false);
  });

  it("rejects /sbin/init (sub-path of blocked /sbin)", () => {
    const result = validateRequest({
      ...validBase,
      workspace_path: "/sbin/init",
    });
    expect(result.success).toBe(false);
  });

  it("still rejects exact dangerous roots (/etc, /usr, /bin, /sbin, /)", () => {
    // Regression: exact root blocking must still work after the fix.
    // Note: /var is intentionally NOT in this list because /var/folders is a
    // legitimate macOS user-space temp directory. Specific /var sub-paths
    // (/var/run, /var/root, /var/db, /var/spool) are blocked instead.
    for (const root of ["/", "/etc", "/usr", "/bin", "/sbin"]) {
      const result = validateRequest({ ...validBase, workspace_path: root });
      expect(result.success, `expected ${root} to be rejected`).toBe(false);
    }
  });

  it("still accepts a legitimately safe path that only shares a prefix character", () => {
    // /home/user/project does not start with any DANGEROUS_ROOT + '/'
    const result = validateRequest({
      ...validBase,
      workspace_path: "/home/user/project",
    });
    expect(result.success).toBe(true);
  });

  it("still accepts /var-data which starts with /var but is NOT a sub-path", () => {
    // /var-data starts with '/var' as a string but is not under /var/run or other
    // specific blocked /var sub-paths. After fix: check for r + '/' prefix.
    const result = validateRequest({
      ...validBase,
      workspace_path: "/var-data/project",
    });
    expect(result.success).toBe(true);
  });

  it("still accepts /var/folders (legitimate macOS temp dir — not blocked)", () => {
    // macOS uses /var/folders/... as the user-space temp directory.
    // The fix deliberately does NOT block all of /var — only specific dangerous
    // sub-paths like /var/run, /var/root, /var/db, /var/spool.
    const result = validateRequest({
      ...validBase,
      workspace_path: "/var/folders/user/T/myproject",
    });
    expect(result.success).toBe(true);
  });
});

// ===========================================================================
// Bug 4 (MEDIUM): Null bytes in workspace_path
// ===========================================================================
// Given: A workspace_path containing a null byte (\x00)
// When:  validateRequest() is called
// Then:  validation fails (null bytes cause OS-level security issues in paths)
// ===========================================================================

describe("Bug 4 – null bytes in workspace_path are rejected", () => {
  it("rejects workspace_path with a null byte", () => {
    // Given: a path containing \x00
    // When:  validateRequest() is called
    // Then:  success === false
    const result = validateRequest({
      ...validBase,
      workspace_path: "/home/user\x00evil",
    });
    expect(result.success).toBe(false);
  });

  it("rejects workspace_path with a null byte at the start", () => {
    const result = validateRequest({
      ...validBase,
      workspace_path: "\x00/home/user",
    });
    expect(result.success).toBe(false);
  });

  it("rejects workspace_path with a null byte at the end", () => {
    const result = validateRequest({
      ...validBase,
      workspace_path: "/home/user/project\x00",
    });
    expect(result.success).toBe(false);
  });

  it("accepts workspace_path without any null bytes (regression)", () => {
    // Given: a clean path with no null bytes
    // When:  validateRequest() is called
    // Then:  success === true (no regression)
    const result = validateRequest({
      ...validBase,
      workspace_path: "/home/user/project",
    });
    expect(result.success).toBe(true);
  });
});

// ===========================================================================
// Bug 5 (MEDIUM): Relative output_path in ResultSchema
// ===========================================================================
// Given: A result with a relative output_path
// When:  validateResult() is called
// Then:  validation fails (relative paths can escape the runs directory)
// ===========================================================================

describe("Bug 5 – relative output_path in ResultSchema is rejected", () => {
  const validResult = {
    run_id: "run-sec20",
    status: "completed" as const,
    summary: "Done",
    summary_truncated: false,
    session_id: null,
    artifacts: [],
    duration_ms: 1000,
    token_usage: null,
    files_changed: null,
  };

  it("rejects relative output_path '../../etc/output.txt'", () => {
    // Given: a result with a relative (traversal) output_path
    // When:  validateResult() is called
    // Then:  success === false
    const result = validateResult({
      ...validResult,
      output_path: "../../etc/output.txt",
    });
    expect(result.success).toBe(false);
  });

  it("rejects relative output_path 'output.txt' (no leading slash)", () => {
    // Given: a relative output_path without traversal (still not absolute)
    // When:  validateResult() is called
    // Then:  success === false
    const result = validateResult({
      ...validResult,
      output_path: "output.txt",
    });
    expect(result.success).toBe(false);
  });

  it("rejects relative output_path './subdir/output.txt'", () => {
    const result = validateResult({
      ...validResult,
      output_path: "./subdir/output.txt",
    });
    expect(result.success).toBe(false);
  });

  it("accepts null output_path (failed run, no output file written)", () => {
    // Given: a failed result with null output_path
    // When:  validateResult() is called
    // Then:  success === true (null is explicitly permitted)
    const result = validateResult({
      ...validResult,
      status: "failed",
      output_path: null,
      error: { code: "ENGINE_CRASH", message: "oops", retryable: true },
    });
    expect(result.success).toBe(true);
  });

  it("accepts absolute output_path '/runs/run-001/output.txt'", () => {
    // Given: an absolute output_path
    // When:  validateResult() is called
    // Then:  success === true (absolute paths are valid)
    const result = validateResult({
      ...validResult,
      output_path: "/runs/run-001/output.txt",
    });
    expect(result.success).toBe(true);
  });

  it("accepts the canonical relative sentinel 'output.txt' only when enforced to be absolute — regression for runner usage", () => {
    // The runner currently writes output_path: "output.txt" (relative) in result.json.
    // After fix, the schema will reject this, so the runner must be updated to write
    // an absolute path. This test documents that the relative form is no longer accepted.
    const result = validateResult({
      ...validResult,
      output_path: "output.txt",
    });
    expect(result.success).toBe(false);
  });
});

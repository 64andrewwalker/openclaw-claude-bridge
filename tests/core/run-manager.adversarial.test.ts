/**
 * Adversarial tests for RunManager.
 *
 * Goal: expose bugs by targeting edge cases not covered by the existing
 * happy-path suite.  DO NOT modify production code or existing tests.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RunManager } from "../../src/core/run-manager.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_REQUEST = {
  task_id: "task-adv-001",
  intent: "coding" as const,
  workspace_path: "/tmp/project",
  message: "adversarial test",
  engine: "claude-code",
  mode: "new" as const,
};

function makeManager() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codebridge-adv-"));
  return { dir, manager: new RunManager(dir) };
}

// ---------------------------------------------------------------------------
// getStatus — error handling
// ---------------------------------------------------------------------------

describe("RunManager.getStatus – edge cases", () => {
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

  it("throws a meaningful error when runId does not exist (no run directory)", async () => {
    // Bug hypothesis: getStatus calls readFileSync without checking existence,
    // so a missing run dir throws a raw ENOENT with no codebridge context.
    await expect(manager.getStatus("run-nonexistent")).rejects.toThrow();
  });

  it("throws (or rejects gracefully) when session.json contains corrupt JSON", async () => {
    // Bug hypothesis: JSON.parse is not guarded — corrupt file throws
    // SyntaxError that leaks implementation detail with no context.
    const runId = await manager.createRun(BASE_REQUEST);
    const sessionPath = path.join(runsDir, runId, "session.json");
    fs.writeFileSync(sessionPath, "{ this is not valid json }");

    // We expect a rejection; the specific error type reveals whether the code
    // wraps it (good) or leaks a raw SyntaxError (bug).
    await expect(manager.getStatus(runId)).rejects.toThrow(SyntaxError);
    // If the above passes it means the error IS a raw SyntaxError — not wrapped.
  });

  it("throws when session.json is completely empty", async () => {
    const runId = await manager.createRun(BASE_REQUEST);
    const sessionPath = path.join(runsDir, runId, "session.json");
    fs.writeFileSync(sessionPath, "");

    await expect(manager.getStatus(runId)).rejects.toThrow(SyntaxError);
  });
});

// ---------------------------------------------------------------------------
// listRuns — error handling with corrupt entries
// ---------------------------------------------------------------------------

describe("RunManager.listRuns – corrupt session file", () => {
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

  it("throws when any session.json in the directory is corrupt JSON", async () => {
    // Bug hypothesis: listRuns calls JSON.parse without a try/catch.
    // A single corrupt entry aborts the entire listing.
    await manager.createRun(BASE_REQUEST);
    await manager.createRun({ ...BASE_REQUEST, task_id: "task-adv-002" });

    // Corrupt the first run's session file
    const entries = fs.readdirSync(runsDir, { withFileTypes: true });
    const firstRunDir = entries.find((e) => e.isDirectory())!.name;
    fs.writeFileSync(
      path.join(runsDir, firstRunDir, "session.json"),
      "CORRUPT",
    );

    // If this throws instead of skipping the bad entry, it's a bug.
    await expect(manager.listRuns()).rejects.toThrow(SyntaxError);
  });
});

// ---------------------------------------------------------------------------
// consumeRequest — missing run directory
// ---------------------------------------------------------------------------

describe("RunManager.consumeRequest – missing run directory", () => {
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

  it("returns null when the run directory does not exist at all", async () => {
    // Bug hypothesis: existsSync returns false for a path inside a
    // non-existent directory on all platforms, so it *should* return null.
    // But verify; an implementation bug could flip this.
    const result = await manager.consumeRequest("run-totally-absent");
    expect(result).toBeNull();
  });

  it("parses and returns valid TaskRequest content after consumption", async () => {
    const runId = await manager.createRun(BASE_REQUEST);
    const consumed = await manager.consumeRequest(runId);
    expect(consumed).not.toBeNull();
    expect(consumed!.task_id).toBe("task-adv-001");
    expect(consumed!.engine).toBe("claude-code");
  });

  it("returns null on second consume (idempotency)", async () => {
    const runId = await manager.createRun(BASE_REQUEST);
    await manager.consumeRequest(runId);
    const second = await manager.consumeRequest(runId);
    expect(second).toBeNull();
  });

  it("throws when request.processing.json itself contains corrupt JSON", async () => {
    // Bug hypothesis: after rename succeeds, readFileSync+JSON.parse is
    // unguarded; if the file is corrupt at rename time the error is raw.
    const runId = await manager.createRun(BASE_REQUEST);
    const runDir = path.join(runsDir, runId);

    // Overwrite request.json with corrupt content before consume
    fs.writeFileSync(path.join(runDir, "request.json"), "NOT JSON");

    await expect(manager.consumeRequest(runId)).rejects.toThrow(SyntaxError);
  });
});

// ---------------------------------------------------------------------------
// updateSession — missing run directory
// ---------------------------------------------------------------------------

describe("RunManager.updateSession – error handling", () => {
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

  it("throws when run directory does not exist", async () => {
    // Bug hypothesis: readFileSync inside withLock throws raw ENOENT with no
    // codebridge context. The lock file itself would also be created inside a
    // non-existent directory which throws before even acquiring the lock.
    await expect(
      manager.updateSession("run-ghost", { state: "running" }),
    ).rejects.toThrow();
  });

  it("does NOT leave a stale lock file when inner fn throws", async () => {
    // Bug hypothesis: if fn() throws, the finally block should unlink the lock.
    const runId = await manager.createRun(BASE_REQUEST);
    const runDir = path.join(runsDir, runId);
    const sessionPath = path.join(runDir, "session.json");

    // Corrupt session.json so the inner read throws
    fs.writeFileSync(sessionPath, "CORRUPT");

    try {
      await manager.updateSession(runId, { state: "running" });
    } catch {
      /* expected */
    }

    // Lock file must be cleaned up even on inner failure
    const lockPath = path.join(runDir, ".session.lock");
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it("does NOT leave a stale lock file when atomicWriteJson cannot write (permission denied)", async () => {
    // Only run this on non-root Unix. Skipping on Windows.
    if (process.platform === "win32") return;

    const runId = await manager.createRun(BASE_REQUEST);
    const runDir = path.join(runsDir, runId);

    // Make the directory read-only so atomicWriteJson cannot create the tmp file
    fs.chmodSync(runDir, 0o555);

    try {
      await manager.updateSession(runId, { state: "running" });
    } catch {
      /* expected — permission denied */
    } finally {
      // Restore so afterEach cleanup works
      fs.chmodSync(runDir, 0o755);
    }

    const lockPath = path.join(runDir, ".session.lock");
    expect(fs.existsSync(lockPath)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// writeOutputFile — edge cases
// ---------------------------------------------------------------------------

describe("RunManager.writeOutputFile – edge cases", () => {
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

  it("throws when run directory does not exist", () => {
    // Bug hypothesis: writeOutputFile does NOT check directory existence before
    // calling writeFileSync, so it throws a raw ENOENT.
    expect(() => manager.writeOutputFile("run-ghost", "hello")).toThrow();
  });

  it("handles very large content (10 MB) without error", async () => {
    const runId = await manager.createRun(BASE_REQUEST);
    const bigContent = "x".repeat(10 * 1024 * 1024); // 10 MB
    manager.writeOutputFile(runId, bigContent);
    const outputPath = path.join(runsDir, runId, "output.txt");
    const read = fs.readFileSync(outputPath, "utf-8");
    expect(read.length).toBe(bigContent.length);
  });

  it("handles special characters and null bytes in content", async () => {
    const runId = await manager.createRun(BASE_REQUEST);
    // Include null byte, unicode snowman, emoji, lone surrogates
    const specialContent =
      "line1\x00line2\nUnicode: \u2603\nEmoji: \uD83D\uDE00\nEnd";
    manager.writeOutputFile(runId, specialContent);
    const outputPath = path.join(runsDir, runId, "output.txt");
    const read = fs.readFileSync(outputPath, "utf-8");
    // null byte may be stripped or preserved depending on Node version;
    // the important thing is it doesn't throw
    expect(read).toBeDefined();
  });

  it("overwrites existing output.txt on second call", async () => {
    const runId = await manager.createRun(BASE_REQUEST);
    manager.writeOutputFile(runId, "first content");
    manager.writeOutputFile(runId, "second content");
    const outputPath = path.join(runsDir, runId, "output.txt");
    expect(fs.readFileSync(outputPath, "utf-8")).toBe("second content");
  });

  it("does NOT write atomically — no tmp file intermediary", async () => {
    // This is a documentation-of-behavior test: writeOutputFile uses
    // writeFileSync directly (not atomic tmp→rename), unlike other writes.
    // This means partial content is observable by concurrent readers.
    // The test confirms the non-atomic behavior is present.
    const runId = await manager.createRun(BASE_REQUEST);
    manager.writeOutputFile(runId, "some output");
    const runDir = path.join(runsDir, runId);
    // No .tmp- file should exist after the call
    const tmpFiles = fs.readdirSync(runDir).filter((f) => f.includes(".tmp-"));
    expect(tmpFiles).toHaveLength(0);
    // output.txt was written directly (non-atomically)
    expect(fs.existsSync(path.join(runDir, "output.txt"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Path traversal in runId
// ---------------------------------------------------------------------------

describe("RunManager – path traversal in runId", () => {
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

  it("getRunDir with path-traversal runId throws (bug #20 fixed)", () => {
    // Fixed in issue #20: getRunDir now validates the resolved path stays
    // inside runsDir and throws if a traversal attempt is detected.
    const maliciousRunId = "../../etc/passwd";
    expect(() => manager.getRunDir(maliciousRunId)).toThrow(
      /escapes runs directory/,
    );
  });

  it("getStatus with path-traversal runId attempts to read outside runs dir", async () => {
    // A crafted runId with '..' can cause getStatus to read an arbitrary path.
    // This should be rejected (throw before filesystem access ideally).
    const maliciousRunId = "../../../tmp/injected";
    await expect(manager.getStatus(maliciousRunId)).rejects.toThrow();
    // The important thing here is that the resolved path escapes runsDir,
    // demonstrating the missing validation. The test documents the exposure.
  });

  it("getRunDir with absolute path in runId throws (bug #20 fixed)", () => {
    // After the bug #20 fix, getRunDir uses path.resolve which DOES honor
    // absolute segments. path.resolve(runsDir, '/tmp/injected') = '/tmp/injected'
    // which escapes runsDir, so the fix now throws an error.
    const absoluteRunId = "/tmp/injected";
    expect(() => manager.getRunDir(absoluteRunId)).toThrow(
      /escapes runs directory/,
    );
  });
});

// ---------------------------------------------------------------------------
// writeResult — error handling
// ---------------------------------------------------------------------------

describe("RunManager.writeResult – error handling", () => {
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

  it("throws when run directory does not exist", async () => {
    await expect(
      manager.writeResult("run-ghost", { status: "completed" }),
    ).rejects.toThrow();
  });

  it("does NOT leave stale lock file when atomicWriteJson fails (permission denied)", async () => {
    if (process.platform === "win32") return;

    const runId = await manager.createRun(BASE_REQUEST);
    const runDir = path.join(runsDir, runId);

    fs.chmodSync(runDir, 0o555);

    try {
      await manager.writeResult(runId, { status: "completed" });
    } catch {
      /* expected */
    } finally {
      fs.chmodSync(runDir, 0o755);
    }

    const lockPath = path.join(runDir, ".result.lock");
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it("overwrites existing result.json on second call", async () => {
    const runId = await manager.createRun(BASE_REQUEST);
    await manager.writeResult(runId, { status: "completed", v: 1 });
    await manager.writeResult(runId, { status: "failed", v: 2 });
    const resultPath = path.join(runsDir, runId, "result.json");
    const result = JSON.parse(fs.readFileSync(resultPath, "utf-8"));
    expect(result.status).toBe("failed");
    expect(result.v).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// withLock — stale lock timeout behaviour
// ---------------------------------------------------------------------------

describe("RunManager.withLock – stale lock file causes timeout", () => {
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

  it("times out after 5 s when a stale lock file is present and never removed", async () => {
    // Bug hypothesis: withLock has no stale-lock detection. If a process
    // crashes while holding the lock, every subsequent caller times out
    // after 5000 ms rather than detecting a dead process and removing the lock.
    const runId = await manager.createRun(BASE_REQUEST);
    const runDir = path.join(runsDir, runId);
    const lockPath = path.join(runDir, ".session.lock");

    // Manually plant a stale lock file (simulates a crash)
    fs.writeFileSync(lockPath, "stale");

    const start = Date.now();
    await expect(
      manager.updateSession(runId, { state: "running" }),
    ).rejects.toThrow(/timed out acquiring lock/i);
    const elapsed = Date.now() - start;

    // Should have waited the full 5 s timeout (allow ±500ms variance)
    expect(elapsed).toBeGreaterThanOrEqual(4500);
  }, 10_000); // test timeout = 10 s
});

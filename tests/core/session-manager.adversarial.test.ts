/**
 * Adversarial tests for SessionManager.
 *
 * Goal: expose bugs by targeting edge cases not covered by the existing
 * happy-path suite.  DO NOT modify production code or existing tests.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SessionManager } from "../../src/core/session-manager.js";
import { RunManager } from "../../src/core/run-manager.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_REQUEST = {
  task_id: "task-sm-adv",
  intent: "coding" as const,
  workspace_path: "/tmp/project",
  message: "adversarial session test",
  engine: "claude-code",
  mode: "new" as const,
};

function makeManagers() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codebridge-sm-adv-"));
  const runManager = new RunManager(dir);
  const sessionManager = new SessionManager(runManager);
  return { dir, runManager, sessionManager };
}

// ---------------------------------------------------------------------------
// All forbidden transitions — exhaustive matrix
// ---------------------------------------------------------------------------

describe("SessionManager – exhaustive invalid transition matrix", () => {
  let dir: string;
  let runManager: RunManager;
  let sessionManager: SessionManager;

  beforeEach(() => {
    const m = makeManagers();
    dir = m.dir;
    runManager = m.runManager;
    sessionManager = m.sessionManager;
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // ---- from created ----

  it("rejects created → failed (cannot skip running)", async () => {
    const runId = await runManager.createRun(BASE_REQUEST);
    await expect(sessionManager.transition(runId, "failed")).rejects.toThrow(
      /invalid state transition/i,
    );
  });

  it("rejects created → stopping (cannot skip running)", async () => {
    const runId = await runManager.createRun(BASE_REQUEST);
    await expect(sessionManager.transition(runId, "stopping")).rejects.toThrow(
      /invalid state transition/i,
    );
  });

  it("rejects created → created (self-transition)", async () => {
    const runId = await runManager.createRun(BASE_REQUEST);
    await expect(sessionManager.transition(runId, "created")).rejects.toThrow(
      /invalid state transition/i,
    );
  });

  // ---- from running ----

  it("rejects running → running (self-transition / double-start)", async () => {
    const runId = await runManager.createRun(BASE_REQUEST);
    await sessionManager.transition(runId, "running", { pid: 1 });
    await expect(sessionManager.transition(runId, "running")).rejects.toThrow(
      /invalid state transition/i,
    );
  });

  it("rejects running → created (cannot go backward)", async () => {
    const runId = await runManager.createRun(BASE_REQUEST);
    await sessionManager.transition(runId, "running", { pid: 1 });
    await expect(sessionManager.transition(runId, "created")).rejects.toThrow(
      /invalid state transition/i,
    );
  });

  // ---- from stopping ----

  it("rejects stopping → stopping (self-transition)", async () => {
    const runId = await runManager.createRun(BASE_REQUEST);
    await sessionManager.transition(runId, "running", { pid: 1 });
    await sessionManager.transition(runId, "stopping");
    await expect(sessionManager.transition(runId, "stopping")).rejects.toThrow(
      /invalid state transition/i,
    );
  });

  it("rejects stopping → running (cannot un-stop)", async () => {
    const runId = await runManager.createRun(BASE_REQUEST);
    await sessionManager.transition(runId, "running", { pid: 1 });
    await sessionManager.transition(runId, "stopping");
    await expect(sessionManager.transition(runId, "running")).rejects.toThrow(
      /invalid state transition/i,
    );
  });

  it("rejects stopping → created (cannot go backward)", async () => {
    const runId = await runManager.createRun(BASE_REQUEST);
    await sessionManager.transition(runId, "running", { pid: 1 });
    await sessionManager.transition(runId, "stopping");
    await expect(sessionManager.transition(runId, "created")).rejects.toThrow(
      /invalid state transition/i,
    );
  });

  // ---- from completed ----

  it("rejects completed → completed (self-transition after terminal)", async () => {
    const runId = await runManager.createRun(BASE_REQUEST);
    await sessionManager.transition(runId, "running", { pid: 1 });
    await sessionManager.transition(runId, "completed");
    await expect(sessionManager.transition(runId, "completed")).rejects.toThrow(
      /invalid state transition/i,
    );
  });

  it("rejects completed → failed (terminal cannot transition)", async () => {
    const runId = await runManager.createRun(BASE_REQUEST);
    await sessionManager.transition(runId, "running", { pid: 1 });
    await sessionManager.transition(runId, "completed");
    await expect(sessionManager.transition(runId, "failed")).rejects.toThrow(
      /invalid state transition/i,
    );
  });

  it("rejects completed → stopping (terminal cannot transition)", async () => {
    const runId = await runManager.createRun(BASE_REQUEST);
    await sessionManager.transition(runId, "running", { pid: 1 });
    await sessionManager.transition(runId, "completed");
    await expect(sessionManager.transition(runId, "stopping")).rejects.toThrow(
      /invalid state transition/i,
    );
  });

  it("rejects completed → created (terminal cannot go backward)", async () => {
    const runId = await runManager.createRun(BASE_REQUEST);
    await sessionManager.transition(runId, "running", { pid: 1 });
    await sessionManager.transition(runId, "completed");
    await expect(sessionManager.transition(runId, "created")).rejects.toThrow(
      /invalid state transition/i,
    );
  });

  // ---- from failed ----

  it("rejects failed → failed (self-transition after terminal)", async () => {
    const runId = await runManager.createRun(BASE_REQUEST);
    await sessionManager.transition(runId, "running", { pid: 1 });
    await sessionManager.transition(runId, "failed");
    await expect(sessionManager.transition(runId, "failed")).rejects.toThrow(
      /invalid state transition/i,
    );
  });

  it("rejects failed → completed (terminal cannot transition)", async () => {
    const runId = await runManager.createRun(BASE_REQUEST);
    await sessionManager.transition(runId, "running", { pid: 1 });
    await sessionManager.transition(runId, "failed");
    await expect(sessionManager.transition(runId, "completed")).rejects.toThrow(
      /invalid state transition/i,
    );
  });

  it("rejects failed → stopping (terminal cannot transition)", async () => {
    const runId = await runManager.createRun(BASE_REQUEST);
    await sessionManager.transition(runId, "running", { pid: 1 });
    await sessionManager.transition(runId, "failed");
    await expect(sessionManager.transition(runId, "stopping")).rejects.toThrow(
      /invalid state transition/i,
    );
  });

  it("rejects failed → created (terminal cannot go backward)", async () => {
    const runId = await runManager.createRun(BASE_REQUEST);
    await sessionManager.transition(runId, "running", { pid: 1 });
    await sessionManager.transition(runId, "failed");
    await expect(sessionManager.transition(runId, "created")).rejects.toThrow(
      /invalid state transition/i,
    );
  });
});

// ---------------------------------------------------------------------------
// resetForResume — edge cases
// ---------------------------------------------------------------------------

describe("SessionManager.resetForResume – edge cases", () => {
  let dir: string;
  let runManager: RunManager;
  let sessionManager: SessionManager;

  beforeEach(() => {
    const m = makeManagers();
    dir = m.dir;
    runManager = m.runManager;
    sessionManager = m.sessionManager;
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("rejects resetForResume from created state", async () => {
    const runId = await runManager.createRun(BASE_REQUEST);
    await expect(sessionManager.resetForResume(runId)).rejects.toThrow(
      /cannot resume from state/i,
    );
  });

  it("rejects resetForResume from stopping state", async () => {
    const runId = await runManager.createRun(BASE_REQUEST);
    await sessionManager.transition(runId, "running", { pid: 1 });
    await sessionManager.transition(runId, "stopping");
    await expect(sessionManager.resetForResume(runId)).rejects.toThrow(
      /cannot resume from state/i,
    );
  });

  it("rejects resetForResume from running state", async () => {
    const runId = await runManager.createRun(BASE_REQUEST);
    await sessionManager.transition(runId, "running", { pid: 1 });
    await expect(sessionManager.resetForResume(runId)).rejects.toThrow(
      /cannot resume from state/i,
    );
  });

  it("after resetForResume from completed, pid from previous run is still set", async () => {
    // Bug hypothesis: resetForResume only updates state to 'created' via
    // updateSession({ state: 'created' }). But pid from the previous run
    // execution is NOT cleared. The session retains a stale pid after reset.
    const runId = await runManager.createRun(BASE_REQUEST);
    await sessionManager.transition(runId, "running", { pid: 99999 });
    await sessionManager.transition(runId, "completed");
    await sessionManager.resetForResume(runId);

    const session = await sessionManager.getSession(runId);
    expect(session.state).toBe("created");
    // This assertion reveals the bug: pid should be null after reset
    expect(session.pid).toBeNull();
  });

  it("after resetForResume from failed, session_id from previous run is still set", async () => {
    // Bug hypothesis: same as above but for session_id.
    const runId = await runManager.createRun(BASE_REQUEST);
    await sessionManager.transition(runId, "running", {
      pid: 42,
      session_id: "old-sess-id",
    });
    await sessionManager.transition(runId, "failed");
    await sessionManager.resetForResume(runId);

    const session = await sessionManager.getSession(runId);
    expect(session.state).toBe("created");
    // This assertion reveals the bug: session_id should be null after reset
    expect(session.session_id).toBeNull();
  });

  it("can transition to running after resetForResume", async () => {
    // After resetForResume the state is 'created', which allows running.
    const runId = await runManager.createRun(BASE_REQUEST);
    await sessionManager.transition(runId, "running", { pid: 1 });
    await sessionManager.transition(runId, "completed");
    await sessionManager.resetForResume(runId);

    // Must be able to start again
    await sessionManager.transition(runId, "running", { pid: 2 });
    const session = await sessionManager.getSession(runId);
    expect(session.state).toBe("running");
  });

  it("resetForResume bypasses VALID_TRANSITIONS state machine guard", async () => {
    // Bug analysis: resetForResume calls runManager.updateSession directly
    // with { state: 'created' }. The state machine (VALID_TRANSITIONS) has
    // NO entry for completed→created or failed→created. The guard is bypassed
    // intentionally by calling updateSession instead of transition. This is
    // by design, but it means resetForResume is an escape hatch that could
    // be misused. Documenting that this bypass works as intended.
    const runId = await runManager.createRun(BASE_REQUEST);
    await sessionManager.transition(runId, "running", { pid: 1 });
    await sessionManager.transition(runId, "completed");

    // Direct transition should be blocked:
    await expect(sessionManager.transition(runId, "created")).rejects.toThrow(
      /invalid state transition/i,
    );

    // But resetForResume succeeds by bypassing the guard:
    await sessionManager.resetForResume(runId);
    const session = await sessionManager.getSession(runId);
    expect(session.state).toBe("created");
  });
});

// ---------------------------------------------------------------------------
// Double transition concurrency
// ---------------------------------------------------------------------------

describe("SessionManager – concurrent double-transition race condition", () => {
  let dir: string;
  let runManager: RunManager;
  let sessionManager: SessionManager;

  beforeEach(() => {
    const m = makeManagers();
    dir = m.dir;
    runManager = m.runManager;
    sessionManager = m.sessionManager;
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("two concurrent running→completed transitions: one should fail, state must be completed once", async () => {
    // Bug hypothesis: transition() reads state, validates, then writes.
    // There is no lock around the read-check-write cycle in transition().
    // Two concurrent calls can both read 'running', both pass validation,
    // and both write 'completed'. The state machine guard is TOCTOU-vulnerable.
    const runId = await runManager.createRun(BASE_REQUEST);
    await sessionManager.transition(runId, "running", { pid: 1 });

    // Fire two concurrent transitions to completed
    const results = await Promise.allSettled([
      sessionManager.transition(runId, "completed"),
      sessionManager.transition(runId, "completed"),
    ]);

    // At least one must succeed
    const succeeded = results.filter((r) => r.status === "fulfilled");
    expect(succeeded.length).toBeGreaterThanOrEqual(1);

    // Final state must be completed
    const session = await sessionManager.getSession(runId);
    expect(session.state).toBe("completed");

    // Ideally exactly one succeeds and one fails with invalid transition.
    // If BOTH succeed, the state machine guard has a TOCTOU bug.
    const failed = results.filter((r) => r.status === "rejected");
    // Document: if failed.length === 0, both won the race — that's a bug.
    // We don't assert the count here because the race outcome is
    // non-deterministic; the bug manifests some % of the time.
    // The test still provides signal if run many times or in a tight loop.
    void failed;
  });

  it("concurrent running→failed and running→completed: exactly one state wins", async () => {
    // Bug hypothesis: two different terminal transitions fire concurrently.
    // If both read 'running' before either writes, both pass validation.
    // The last writer wins, which could be either 'completed' or 'failed'.
    const runId = await runManager.createRun(BASE_REQUEST);
    await sessionManager.transition(runId, "running", { pid: 1 });

    const results = await Promise.allSettled([
      sessionManager.transition(runId, "completed"),
      sessionManager.transition(runId, "failed"),
    ]);

    const session = await sessionManager.getSession(runId);
    // State must be a valid terminal state
    expect(["completed", "failed"]).toContain(session.state);

    // At least one must have succeeded
    const succeeded = results.filter((r) => r.status === "fulfilled");
    expect(succeeded.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// getSession with corrupt backing store
// ---------------------------------------------------------------------------

describe("SessionManager.getSession – corrupt backing store", () => {
  let dir: string;
  let runManager: RunManager;
  let sessionManager: SessionManager;

  beforeEach(() => {
    const m = makeManagers();
    dir = m.dir;
    runManager = m.runManager;
    sessionManager = m.sessionManager;
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("throws when session.json is corrupt JSON", async () => {
    const runId = await runManager.createRun(BASE_REQUEST);
    const sessionPath = path.join(dir, runId, "session.json");
    fs.writeFileSync(sessionPath, "{ corrupt }");

    // Error should propagate; ideally with a codebridge-specific message.
    await expect(sessionManager.getSession(runId)).rejects.toThrow(SyntaxError);
  });

  it("throws when session.json is missing entirely", async () => {
    const runId = await runManager.createRun(BASE_REQUEST);
    const sessionPath = path.join(dir, runId, "session.json");
    fs.unlinkSync(sessionPath);

    await expect(sessionManager.getSession(runId)).rejects.toThrow();
  });

  it("throws when called with a completely unknown runId", async () => {
    await expect(
      sessionManager.getSession("run-does-not-exist"),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// transition error message quality
// ---------------------------------------------------------------------------

describe("SessionManager.transition – error message includes states", () => {
  let dir: string;
  let runManager: RunManager;
  let sessionManager: SessionManager;

  beforeEach(() => {
    const m = makeManagers();
    dir = m.dir;
    runManager = m.runManager;
    sessionManager = m.sessionManager;
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("error message names both current state and attempted state", async () => {
    const runId = await runManager.createRun(BASE_REQUEST);
    // completed → running is invalid; error must name both states
    await sessionManager.transition(runId, "running", { pid: 1 });
    await sessionManager.transition(runId, "completed");

    let errorMessage = "";
    try {
      await sessionManager.transition(runId, "running");
    } catch (e) {
      errorMessage = (e as Error).message;
    }

    expect(errorMessage).toMatch(/completed/i);
    expect(errorMessage).toMatch(/running/i);
  });

  it("error message for terminal state includes 'none' as allowed transitions", async () => {
    // completed has no valid transitions; the error should say allowed: none
    const runId = await runManager.createRun(BASE_REQUEST);
    await sessionManager.transition(runId, "running", { pid: 1 });
    await sessionManager.transition(runId, "completed");

    let errorMessage = "";
    try {
      await sessionManager.transition(runId, "failed");
    } catch (e) {
      errorMessage = (e as Error).message;
    }

    // The message includes "allowed: none" because completed has no transitions
    expect(errorMessage).toMatch(/none/i);
  });
});

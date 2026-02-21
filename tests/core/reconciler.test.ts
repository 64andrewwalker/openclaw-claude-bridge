import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Reconciler } from "../../src/core/reconciler";
import { RunManager } from "../../src/core/run-manager";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

describe("Reconciler", () => {
  let runsDir: string;
  let runManager: RunManager;

  beforeEach(() => {
    runsDir = fs.mkdtempSync(path.join(os.tmpdir(), "codebridge-reconcile-"));
    runManager = new RunManager(runsDir);
  });

  afterEach(() => {
    fs.rmSync(runsDir, { recursive: true, force: true });
  });

  it("marks orphaned running task as failed with RUNNER_CRASH_RECOVERY", async () => {
    const runId = await runManager.createRun({
      task_id: "task-001",
      intent: "coding" as const,
      workspace_path: "/tmp/project",
      message: "Orphan",
      engine: "claude-code",
      mode: "new" as const,
    });
    await runManager.updateSession(runId, { state: "running", pid: 99999 });

    const reconciler = new Reconciler(runManager);
    const actions = await reconciler.reconcile();

    expect(actions).toHaveLength(1);
    expect(actions[0].action).toBe("marked_failed");
    expect(actions[0].runId).toBe(runId);
    expect(actions[0].detail).toContain("pid 99999");
    const session = await runManager.getStatus(runId);
    expect(session.state).toBe("failed");
    // Check result.json was written
    const resultPath = path.join(runsDir, runId, "result.json");
    const result = JSON.parse(fs.readFileSync(resultPath, "utf-8"));
    expect(result.error.code).toBe("RUNNER_CRASH_RECOVERY");
    expect(result.error.retryable).toBe(true);
  });

  it("reconciles completed task from result.json", async () => {
    const runId = await runManager.createRun({
      task_id: "task-002",
      intent: "coding" as const,
      workspace_path: "/tmp/project",
      message: "Completed",
      engine: "claude-code",
      mode: "new" as const,
    });
    await runManager.updateSession(runId, { state: "running", pid: 99999 });
    await runManager.writeResult(runId, {
      status: "completed",
      summary: "Done",
    });

    const reconciler = new Reconciler(runManager);
    const actions = await reconciler.reconcile();

    expect(actions).toHaveLength(1);
    expect(actions[0].action).toBe("marked_completed");
    expect(actions[0].runId).toBe(runId);
    const session = await runManager.getStatus(runId);
    expect(session.state).toBe("completed");
  });

  it("leaves still-running process alone", async () => {
    const runId = await runManager.createRun({
      task_id: "task-003",
      intent: "coding" as const,
      workspace_path: "/tmp/project",
      message: "Still running",
      engine: "claude-code",
      mode: "new" as const,
    });
    await runManager.updateSession(runId, {
      state: "running",
      pid: process.pid,
    });

    const reconciler = new Reconciler(runManager);
    const actions = await reconciler.reconcile();

    expect(actions).toHaveLength(0);
    const session = await runManager.getStatus(runId);
    expect(session.state).toBe("running");
  });

  it("skips non-running sessions", async () => {
    const runId = await runManager.createRun({
      task_id: "task-004",
      intent: "coding" as const,
      workspace_path: "/tmp/project",
      message: "Already done",
      engine: "claude-code",
      mode: "new" as const,
    });
    // state stays 'created' — should be skipped

    const reconciler = new Reconciler(runManager);
    const actions = await reconciler.reconcile();
    expect(actions).toHaveLength(0);
  });

  it("writes reconciliation actions to log files", async () => {
    const runId = await runManager.createRun({
      task_id: "task-log",
      intent: "coding",
      workspace_path: "/tmp/project",
      message: "Log test",
      engine: "claude-code",
      mode: "new",
    });
    await runManager.updateSession(runId, { state: "running", pid: 99999 });

    const reconciler = new Reconciler(runManager);
    await reconciler.reconcile();

    // Check global log
    const globalLog = fs.readFileSync(
      path.join(runsDir, "reconciliation.log"),
      "utf-8",
    );
    expect(globalLog).toContain(runId);
    expect(globalLog).toContain("marked_failed");

    // Check per-run log
    const runLog = fs.readFileSync(
      path.join(runsDir, runId, "logs", "reconciliation.log"),
      "utf-8",
    );
    expect(runLog).toContain(runId);
  });

  it("reconciles failed task from result.json with failed status", async () => {
    const runId = await runManager.createRun({
      task_id: "task-005",
      intent: "coding" as const,
      workspace_path: "/tmp/project",
      message: "Failed externally",
      engine: "claude-code",
      mode: "new" as const,
    });
    await runManager.updateSession(runId, { state: "running", pid: 99999 });
    await runManager.writeResult(runId, {
      status: "failed",
      summary: "Engine crashed",
      error: {
        code: "ENGINE_CRASH",
        message: "Engine process crashed",
        retryable: true,
      },
    });

    const reconciler = new Reconciler(runManager);
    const actions = await reconciler.reconcile();

    expect(actions).toHaveLength(1);
    expect(actions[0].action).toBe("marked_failed");
    const session = await runManager.getStatus(runId);
    expect(session.state).toBe("failed");
  });

  it("treats corrupt result.json as orphaned and rewrites failed result", async () => {
    const runId = await runManager.createRun({
      task_id: "task-006",
      intent: "coding" as const,
      workspace_path: "/tmp/project",
      message: "Corrupt result",
      engine: "claude-code",
      mode: "new" as const,
    });
    await runManager.updateSession(runId, { state: "running", pid: 99999 });
    const resultPath = path.join(runsDir, runId, "result.json");
    fs.writeFileSync(resultPath, "{ invalid json");

    const reconciler = new Reconciler(runManager);
    const actions = await reconciler.reconcile();

    expect(actions).toHaveLength(1);
    expect(actions[0].action).toBe("marked_failed");
    expect(actions[0].detail).toContain("missing/corrupt result.json");

    const session = await runManager.getStatus(runId);
    expect(session.state).toBe("failed");
    const rewritten = JSON.parse(fs.readFileSync(resultPath, "utf-8"));
    expect(rewritten.error.code).toBe("RUNNER_CRASH_RECOVERY");
  });

  // BDD: Bug 1 — stopping state with dead PID should be cleaned up
  // Scenario: A run is in 'stopping' state with a dead PID
  //   Given a run that was gracefully stopping
  //   And the process (PID) has since died
  //   When the reconciler runs at daemon startup
  //   Then the run should be marked failed (not left permanently stuck)
  it("cleans up stopping state with dead PID — marks as failed", async () => {
    const runId = await runManager.createRun({
      task_id: "task-stopping-dead",
      intent: "coding" as const,
      workspace_path: "/tmp/project",
      message: "Stopping but dead",
      engine: "claude-code",
      mode: "new" as const,
    });
    // Simulate a run stuck in 'stopping' with a dead PID (99999 is not alive)
    await runManager.updateSession(runId, { state: "stopping", pid: 99999 });

    const reconciler = new Reconciler(runManager);
    const actions = await reconciler.reconcile();

    expect(actions).toHaveLength(1);
    expect(actions[0].action).toBe("marked_failed");
    expect(actions[0].runId).toBe(runId);
    const session = await runManager.getStatus(runId);
    expect(session.state).toBe("failed");
    // result.json should be written with RUNNER_CRASH_RECOVERY
    const resultPath = path.join(runsDir, runId, "result.json");
    const result = JSON.parse(fs.readFileSync(resultPath, "utf-8"));
    expect(result.error.code).toBe("RUNNER_CRASH_RECOVERY");
  });

  // BDD: Bug 1 — stopping state with live PID should be left alone
  // Scenario: A run is in 'stopping' state and the process is still alive
  //   Given a run gracefully stopping
  //   And the process is still running
  //   When the reconciler runs
  //   Then the run should NOT be disturbed
  it("leaves stopping state with live PID alone", async () => {
    const runId = await runManager.createRun({
      task_id: "task-stopping-alive",
      intent: "coding" as const,
      workspace_path: "/tmp/project",
      message: "Stopping but alive",
      engine: "claude-code",
      mode: "new" as const,
    });
    // Use current process PID — definitely alive
    await runManager.updateSession(runId, {
      state: "stopping",
      pid: process.pid,
    });

    const reconciler = new Reconciler(runManager);
    const actions = await reconciler.reconcile();

    expect(actions).toHaveLength(0);
    const session = await runManager.getStatus(runId);
    expect(session.state).toBe("stopping");
  });

  // BDD: Bug 1 — stopping state with result.json should reconcile from result
  // Scenario: A run in 'stopping' state has finished writing result.json
  //   Given a run that completed while it was being asked to stop
  //   And the process has since died
  //   And result.json exists with status 'completed'
  //   When the reconciler runs
  //   Then the run should be marked completed from result.json
  it("reconciles stopping state from result.json when process is dead", async () => {
    const runId = await runManager.createRun({
      task_id: "task-stopping-with-result",
      intent: "coding" as const,
      workspace_path: "/tmp/project",
      message: "Stopped with result",
      engine: "claude-code",
      mode: "new" as const,
    });
    await runManager.updateSession(runId, { state: "stopping", pid: 99999 });
    await runManager.writeResult(runId, {
      status: "completed",
      summary: "Done before stop",
    });

    const reconciler = new Reconciler(runManager);
    const actions = await reconciler.reconcile();

    expect(actions).toHaveLength(1);
    expect(actions[0].action).toBe("marked_completed");
    const session = await runManager.getStatus(runId);
    expect(session.state).toBe("completed");
  });
});

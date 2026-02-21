/**
 * Adversarial tests for the `codebridge stop` CLI command.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const CLI = "npx tsx src/cli/index.ts";
const CWD = process.cwd();

describe("codebridge stop – adversarial", () => {
  let runsDir: string;
  let workspaceDir: string;

  beforeEach(() => {
    runsDir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-stopadv-runs-"));
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-stopadv-ws-"));
  });

  afterEach(() => {
    fs.rmSync(runsDir, { recursive: true, force: true });
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // Missing run_id argument
  // -----------------------------------------------------------------------
  it("exits non-zero when run_id argument is missing", () => {
    const result = spawnSync(
      "npx",
      ["tsx", "src/cli/index.ts", "stop", "--runs-dir", runsDir],
      { encoding: "utf-8", cwd: CWD },
    );
    expect(result.status).not.toBe(0);
  });

  // -----------------------------------------------------------------------
  // Non-existent run_id
  // -----------------------------------------------------------------------
  it("exits non-zero when run_id does not exist", () => {
    const result = spawnSync(
      "npx",
      [
        "tsx",
        "src/cli/index.ts",
        "stop",
        "run-doesnotexist",
        "--runs-dir",
        runsDir,
      ],
      { encoding: "utf-8", cwd: CWD },
    );
    expect(result.status).not.toBe(0);
  });

  // -----------------------------------------------------------------------
  // Stopping a run that is not running (already completed)
  // -----------------------------------------------------------------------
  it("exits non-zero when trying to stop an already-completed run", async () => {
    const { RunManager } = await import("../../src/core/run-manager.js");
    const { SessionManager } =
      await import("../../src/core/session-manager.js");
    const runManager = new RunManager(runsDir);
    const sessionManager = new SessionManager(runManager);
    const runId = await runManager.createRun({
      task_id: "task-stop-adv",
      intent: "coding",
      workspace_path: workspaceDir,
      message: "Already done",
      engine: "claude-code",
      mode: "new",
    });

    // Transition to completed
    await sessionManager.transition(runId, "running");
    await sessionManager.transition(runId, "completed");

    const result = spawnSync(
      "npx",
      ["tsx", "src/cli/index.ts", "stop", runId, "--runs-dir", runsDir],
      { encoding: "utf-8", cwd: CWD },
    );
    // stop.ts checks state !== 'running' and exits with code 1
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("not running");
  });

  // -----------------------------------------------------------------------
  // Stopping a created (not yet started) run
  // -----------------------------------------------------------------------
  it("exits non-zero when trying to stop a created (not yet running) run", async () => {
    const { RunManager } = await import("../../src/core/run-manager.js");
    const runManager = new RunManager(runsDir);
    const runId = await runManager.createRun({
      task_id: "task-stop-adv-created",
      intent: "coding",
      workspace_path: workspaceDir,
      message: "Not started",
      engine: "claude-code",
      mode: "new",
    });

    const result = spawnSync(
      "npx",
      ["tsx", "src/cli/index.ts", "stop", runId, "--runs-dir", runsDir],
      { encoding: "utf-8", cwd: CWD },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("not running");
  });

  // -----------------------------------------------------------------------
  // Bug #4 (issue #25): --force-timeout with invalid (non-numeric) value
  // -----------------------------------------------------------------------
  it("exits non-zero when --force-timeout is non-numeric (NaN)", async () => {
    // parseInt('abc') = NaN — if unvalidated, waitForExit's timeout check
    // (`Date.now() - start > NaN`) always evaluates false, causing an infinite loop.
    // Fix: validate --force-timeout is a positive integer before proceeding.
    const { RunManager } = await import("../../src/core/run-manager.js");
    const { SessionManager } =
      await import("../../src/core/session-manager.js");
    const runManager = new RunManager(runsDir);
    const sessionManager = new SessionManager(runManager);
    const runId = await runManager.createRun({
      task_id: "task-stop-nan-timeout",
      intent: "coding",
      workspace_path: workspaceDir,
      message: "NaN timeout test",
      engine: "claude-code",
      mode: "new",
    });
    await sessionManager.transition(runId, "running");

    const result = spawnSync(
      "npx",
      [
        "tsx",
        "src/cli/index.ts",
        "stop",
        runId,
        "--runs-dir",
        runsDir,
        "--force-timeout",
        "abc",
      ],
      { encoding: "utf-8", cwd: CWD, timeout: 10000 },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/force-timeout/i);
  });

  it("exits non-zero when --force-timeout is zero", async () => {
    const { RunManager } = await import("../../src/core/run-manager.js");
    const { SessionManager } =
      await import("../../src/core/session-manager.js");
    const runManager = new RunManager(runsDir);
    const sessionManager = new SessionManager(runManager);
    const runId = await runManager.createRun({
      task_id: "task-stop-zero-timeout",
      intent: "coding",
      workspace_path: workspaceDir,
      message: "Zero timeout test",
      engine: "claude-code",
      mode: "new",
    });
    await sessionManager.transition(runId, "running");

    const result = spawnSync(
      "npx",
      [
        "tsx",
        "src/cli/index.ts",
        "stop",
        runId,
        "--runs-dir",
        runsDir,
        "--force-timeout",
        "0",
      ],
      { encoding: "utf-8", cwd: CWD, timeout: 10000 },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/force-timeout/i);
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { RunManager } from "../../src/core/run-manager";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

describe("RunManager", () => {
  let runsDir: string;
  let manager: RunManager;

  beforeEach(() => {
    runsDir = fs.mkdtempSync(path.join(os.tmpdir(), "codebridge-test-"));
    manager = new RunManager(runsDir);
  });

  afterEach(() => {
    fs.rmSync(runsDir, { recursive: true, force: true });
  });

  it("creates a run directory with request.json and session.json", async () => {
    const request = {
      task_id: "task-001",
      intent: "coding" as const,
      workspace_path: "/tmp/project",
      message: "Add login",
      engine: "claude-code",
      mode: "new" as const,
    };
    const runId = await manager.createRun(request);
    const runDir = path.join(runsDir, runId);
    expect(fs.existsSync(path.join(runDir, "request.json"))).toBe(true);
    expect(fs.existsSync(path.join(runDir, "session.json"))).toBe(true);
    expect(fs.existsSync(path.join(runDir, "request.tmp"))).toBe(false);
    expect(fs.existsSync(path.join(runDir, "context"))).toBe(true);
    expect(fs.existsSync(path.join(runDir, "logs"))).toBe(true);
    expect(fs.existsSync(path.join(runDir, "artifacts"))).toBe(true);
  });

  it("reads run status from session.json", async () => {
    const request = {
      task_id: "task-001",
      intent: "coding" as const,
      workspace_path: "/tmp/project",
      message: "Add login",
      engine: "claude-code",
      mode: "new" as const,
    };
    const runId = await manager.createRun(request);
    const status = await manager.getStatus(runId);
    expect(status.state).toBe("created");
    expect(status.engine).toBe("claude-code");
  });

  it("lists all runs with their states", async () => {
    const base = {
      intent: "coding" as const,
      workspace_path: "/tmp/project",
      message: "Do something",
      engine: "claude-code",
      mode: "new" as const,
    };
    await manager.createRun({ ...base, task_id: "task-1" });
    await manager.createRun({ ...base, task_id: "task-2" });
    await manager.createRun({ ...base, task_id: "task-3" });
    const runs = await manager.listRuns();
    expect(runs).toHaveLength(3);
    expect(runs.every((r) => r.state === "created")).toBe(true);
  });

  it("atomically consumes request.json for processing", async () => {
    const request = {
      task_id: "task-001",
      intent: "coding" as const,
      workspace_path: "/tmp/project",
      message: "Add login",
      engine: "claude-code",
      mode: "new" as const,
    };
    const runId = await manager.createRun(request);
    const consumed = await manager.consumeRequest(runId);
    const runDir = path.join(runsDir, runId);
    expect(consumed).not.toBeNull();
    expect(fs.existsSync(path.join(runDir, "request.json"))).toBe(false);
    expect(fs.existsSync(path.join(runDir, "request.processing.json"))).toBe(
      true,
    );
  });

  it("returns null when consuming already-consumed request", async () => {
    const request = {
      task_id: "task-001",
      intent: "coding" as const,
      workspace_path: "/tmp/project",
      message: "Add login",
      engine: "claude-code",
      mode: "new" as const,
    };
    const runId = await manager.createRun(request);
    await manager.consumeRequest(runId);
    const second = await manager.consumeRequest(runId);
    expect(second).toBeNull();
  });

  it("updates session with partial fields", async () => {
    const request = {
      task_id: "task-001",
      intent: "coding" as const,
      workspace_path: "/tmp/project",
      message: "Add login",
      engine: "claude-code",
      mode: "new" as const,
    };
    const runId = await manager.createRun(request);
    await manager.updateSession(runId, { state: "running", pid: 12345 });
    const status = await manager.getStatus(runId);
    expect(status.state).toBe("running");
    expect(status.pid).toBe(12345);
    const runDir = path.join(runsDir, runId);
    const tempFiles = fs
      .readdirSync(runDir)
      .filter((f) => f.includes(".tmp-") || f.endsWith(".lock"));
    expect(tempFiles).toHaveLength(0);
  });

  it("writes and reads result.json", async () => {
    const request = {
      task_id: "task-001",
      intent: "coding" as const,
      workspace_path: "/tmp/project",
      message: "Add login",
      engine: "claude-code",
      mode: "new" as const,
    };
    const runId = await manager.createRun(request);
    await manager.writeResult(runId, { status: "completed", summary: "Done" });
    const resultPath = path.join(runsDir, runId, "result.json");
    const result = JSON.parse(fs.readFileSync(resultPath, "utf-8"));
    expect(result.status).toBe("completed");
    const runDir = path.join(runsDir, runId);
    const tempFiles = fs
      .readdirSync(runDir)
      .filter((f) => f.includes(".tmp-") || f.endsWith(".lock"));
    expect(tempFiles).toHaveLength(0);
  });

  it("writes output file and reads back identical content", async () => {
    const request = {
      task_id: "task-001",
      intent: "coding" as const,
      workspace_path: "/tmp/project",
      message: "Add login",
      engine: "claude-code",
      mode: "new" as const,
    };
    const runId = await manager.createRun(request);
    const content =
      "Hello, this is the full engine output.\nWith multiple lines.";
    manager.writeOutputFile(runId, content);
    const outputPath = path.join(runsDir, runId, "output.txt");
    expect(fs.existsSync(outputPath)).toBe(true);
    expect(fs.readFileSync(outputPath, "utf-8")).toBe(content);
  });

  it("writes empty output file", async () => {
    const request = {
      task_id: "task-001",
      intent: "coding" as const,
      workspace_path: "/tmp/project",
      message: "Add login",
      engine: "claude-code",
      mode: "new" as const,
    };
    const runId = await manager.createRun(request);
    manager.writeOutputFile(runId, "");
    const outputPath = path.join(runsDir, runId, "output.txt");
    expect(fs.existsSync(outputPath)).toBe(true);
    expect(fs.readFileSync(outputPath, "utf-8")).toBe("");
  });

  // BDD: Bug 2 — corrupt session.json must not abort listRuns()
  // Scenario: One run directory contains a corrupt (invalid JSON) session.json
  //   Given three run directories exist
  //   And one session.json is truncated/corrupt
  //   When listRuns() is called
  //   Then the two valid runs are returned (no exception thrown)
  //   And the corrupt entry is silently skipped
  it("skips corrupt session.json entries and continues listing valid runs", async () => {
    const base = {
      intent: "coding" as const,
      workspace_path: "/tmp/project",
      message: "Do something",
      engine: "claude-code",
      mode: "new" as const,
    };
    const runId1 = await manager.createRun({ ...base, task_id: "task-good-1" });
    const runId2 = await manager.createRun({
      ...base,
      task_id: "task-corrupt",
    });
    const runId3 = await manager.createRun({ ...base, task_id: "task-good-2" });

    // Corrupt one session.json
    const corruptSessionPath = path.join(runsDir, runId2, "session.json");
    fs.writeFileSync(corruptSessionPath, "{ this is not valid json !!!!");

    // Should not throw — corrupt entry is skipped
    const runs = await manager.listRuns();
    const ids = runs.map((r) => r.run_id);
    expect(runs).toHaveLength(2);
    expect(ids).toContain(runId1);
    expect(ids).toContain(runId3);
    expect(ids).not.toContain(runId2);
  });

  // BDD: Bug 2 — completely empty session.json is also skipped
  // Scenario: A session.json file is empty (e.g. interrupted write)
  //   Given a run directory with an empty session.json
  //   When listRuns() is called
  //   Then the empty entry is skipped without throwing
  it("skips empty session.json entries without throwing", async () => {
    const runId = await manager.createRun({
      task_id: "task-empty-session",
      intent: "coding" as const,
      workspace_path: "/tmp/project",
      message: "Test",
      engine: "claude-code",
      mode: "new" as const,
    });

    // Overwrite with empty content
    fs.writeFileSync(path.join(runsDir, runId, "session.json"), "");

    // Should not throw
    const runs = await manager.listRuns();
    expect(runs).toHaveLength(0);
  });
});

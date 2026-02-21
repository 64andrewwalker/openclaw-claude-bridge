import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TaskRunner } from "../../src/core/runner.js";
import { RunManager } from "../../src/core/run-manager.js";
import { SessionManager } from "../../src/core/session-manager.js";
import { ClaudeCodeEngine } from "../../src/engines/claude-code.js";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

describe("TaskRunner", () => {
  let runsDir: string;
  let workspaceDir: string;
  let runManager: RunManager;
  let sessionManager: SessionManager;

  beforeEach(() => {
    runsDir = fs.mkdtempSync(path.join(os.tmpdir(), "codebridge-runner-"));
    workspaceDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "codebridge-workspace-"),
    );
    runManager = new RunManager(runsDir);
    sessionManager = new SessionManager(runManager);
  });

  afterEach(() => {
    fs.rmSync(runsDir, { recursive: true, force: true });
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  });

  it("executes a task end-to-end producing result.json", async () => {
    const engine = new ClaudeCodeEngine({
      command: "echo",
      defaultArgs: ["task completed successfully"],
    });
    const runner = new TaskRunner(runManager, sessionManager, engine);
    const runId = await runManager.createRun({
      task_id: "task-001",
      intent: "coding",
      workspace_path: workspaceDir,
      message: "Add login",
      engine: "claude-code",
      mode: "new",
    });

    await runner.processRun(runId);

    const session = await sessionManager.getSession(runId);
    expect(session.state).toBe("completed");

    const resultPath = path.join(runsDir, runId, "result.json");
    expect(fs.existsSync(resultPath)).toBe(true);
    const result = JSON.parse(fs.readFileSync(resultPath, "utf-8"));
    expect(result.status).toBe("completed");
    expect(result.summary).toContain("task completed");
    expect(result.output_path).toBe("output.txt");
    expect(result.summary_truncated).toBe(false);
    const outputPath = path.join(runsDir, runId, "output.txt");
    expect(fs.existsSync(outputPath)).toBe(true);
    expect(fs.readFileSync(outputPath, "utf-8")).toContain("task completed");
    expect(result.duration_ms).toBeTypeOf("number");
  });

  it("handles engine failure and writes error to result", async () => {
    const engine = new ClaudeCodeEngine({ command: "false" });
    const runner = new TaskRunner(runManager, sessionManager, engine);
    const runId = await runManager.createRun({
      task_id: "task-001",
      intent: "coding",
      workspace_path: workspaceDir,
      message: "Will fail",
      engine: "claude-code",
      mode: "new",
    });

    await runner.processRun(runId);

    const session = await sessionManager.getSession(runId);
    expect(session.state).toBe("failed");

    const resultPath = path.join(runsDir, runId, "result.json");
    const result = JSON.parse(fs.readFileSync(resultPath, "utf-8"));
    expect(result.status).toBe("failed");
    expect(result.error.code).toBe("ENGINE_CRASH");
    expect(result.error.retryable).toBe(true);
  });

  it("rejects request with workspace outside allowed_roots", async () => {
    const engine = new ClaudeCodeEngine({
      command: "echo",
      defaultArgs: ["should not run"],
    });
    const runner = new TaskRunner(runManager, sessionManager, engine);
    const runId = await runManager.createRun({
      task_id: "task-sec",
      intent: "coding",
      workspace_path: workspaceDir,
      message: "Test",
      engine: "claude-code",
      mode: "new",
      allowed_roots: ["/some/other/path"],
    });
    await runner.processRun(runId);
    const session = await sessionManager.getSession(runId);
    expect(session.state).toBe("failed");
    const resultPath = path.join(runsDir, runId, "result.json");
    const result = JSON.parse(fs.readFileSync(resultPath, "utf-8"));
    expect(result.error.code).toBe("WORKSPACE_INVALID");
  });

  it("rejects path traversal attempts", async () => {
    // Use a sibling of workspaceDir to escape allowed_roots without hitting DANGEROUS_ROOTS
    const siblingDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "codebridge-sibling-"),
    );
    try {
      const engine = new ClaudeCodeEngine({
        command: "echo",
        defaultArgs: ["should not run"],
      });
      const runner = new TaskRunner(runManager, sessionManager, engine);
      const traversalPath = path.join(
        workspaceDir,
        "..",
        path.basename(siblingDir),
      );
      const runId = await runManager.createRun({
        task_id: "task-traversal",
        intent: "coding",
        workspace_path: traversalPath,
        message: "Traversal",
        engine: "claude-code",
        mode: "new",
        allowed_roots: [workspaceDir],
      });
      await runner.processRun(runId);
      const resultPath = path.join(runsDir, runId, "result.json");
      const result = JSON.parse(fs.readFileSync(resultPath, "utf-8"));
      expect(result.error.code).toBe("WORKSPACE_INVALID");
    } finally {
      fs.rmSync(siblingDir, { recursive: true, force: true });
    }
  });

  it("rejects filesystem root as allowed_root", async () => {
    const engine = new ClaudeCodeEngine({
      command: "echo",
      defaultArgs: ["should not run"],
    });
    const runner = new TaskRunner(runManager, sessionManager, engine);
    const runId = await runManager.createRun({
      task_id: "task-fsroot",
      intent: "coding",
      workspace_path: workspaceDir,
      message: "Root escape",
      engine: "claude-code",
      mode: "new",
      allowed_roots: ["/"],
    });
    await runner.processRun(runId);
    const resultPath = path.join(runsDir, runId, "result.json");
    const result = JSON.parse(fs.readFileSync(resultPath, "utf-8"));
    expect(result.error.code).toBe("WORKSPACE_INVALID");
    expect(result.error.message).toContain("not permitted");
  });

  it("rejects sibling-prefix path that shares allowed_root prefix", async () => {
    const evilDir = fs.mkdtempSync(workspaceDir + "-evil");
    try {
      const engine = new ClaudeCodeEngine({
        command: "echo",
        defaultArgs: ["should not run"],
      });
      const runner = new TaskRunner(runManager, sessionManager, engine);
      const runId = await runManager.createRun({
        task_id: "task-sibling",
        intent: "coding",
        workspace_path: evilDir,
        message: "Sibling prefix",
        engine: "claude-code",
        mode: "new",
        allowed_roots: [workspaceDir],
      });
      await runner.processRun(runId);
      const resultPath = path.join(runsDir, runId, "result.json");
      const result = JSON.parse(fs.readFileSync(resultPath, "utf-8"));
      expect(result.error.code).toBe("WORKSPACE_INVALID");
    } finally {
      fs.rmSync(evilDir, { recursive: true, force: true });
    }
  });

  it("allows workspace within allowed_roots", async () => {
    const engine = new ClaudeCodeEngine({
      command: "echo",
      defaultArgs: ["secure ok"],
    });
    const runner = new TaskRunner(runManager, sessionManager, engine);
    const subDir = path.join(workspaceDir, "subproject");
    fs.mkdirSync(subDir);
    const runId = await runManager.createRun({
      task_id: "task-ok",
      intent: "coding",
      workspace_path: subDir,
      message: "OK",
      engine: "claude-code",
      mode: "new",
      allowed_roots: [workspaceDir],
    });
    await runner.processRun(runId);
    const session = await sessionManager.getSession(runId);
    expect(session.state).toBe("completed");
  });

  it("rejects non-existent workspace without invoking engine", async () => {
    const engine = new ClaudeCodeEngine({
      command: "echo",
      defaultArgs: ["should not run"],
    });
    const runner = new TaskRunner(runManager, sessionManager, engine);
    const runId = await runManager.createRun({
      task_id: "task-001",
      intent: "coding",
      workspace_path: "/nonexistent/path/12345",
      message: "Bad workspace",
      engine: "claude-code",
      mode: "new",
    });

    await runner.processRun(runId);

    const session = await sessionManager.getSession(runId);
    expect(session.state).toBe("failed");

    const resultPath = path.join(runsDir, runId, "result.json");
    const result = JSON.parse(fs.readFileSync(resultPath, "utf-8"));
    expect(result.error.code).toBe("WORKSPACE_NOT_FOUND");
    expect(result.error.retryable).toBe(false);
  });

  it("includes files_changed in result for git workspace", async () => {
    // Set up a git repo as workspace
    execSync(
      'git init && git config user.email "test@test.com" && git config user.name "Test"',
      { cwd: workspaceDir },
    );
    fs.writeFileSync(path.join(workspaceDir, "existing.txt"), "original");
    execSync('git add . && git commit -m "init"', { cwd: workspaceDir });

    // Engine script that modifies a file and creates a new one
    const script = `bash -c 'echo modified > ${workspaceDir}/existing.txt && echo new > ${workspaceDir}/added.txt'`;
    const engine = new ClaudeCodeEngine({
      command: "bash",
      defaultArgs: [
        "-c",
        `echo modified > ${workspaceDir}/existing.txt && echo new > ${workspaceDir}/added.txt && echo done`,
      ],
    });
    const runner = new TaskRunner(runManager, sessionManager, engine);
    const runId = await runManager.createRun({
      task_id: "task-fc",
      intent: "coding",
      workspace_path: workspaceDir,
      message: "Modify files",
      engine: "claude-code",
      mode: "new",
    });

    await runner.processRun(runId);

    const resultPath = path.join(runsDir, runId, "result.json");
    const result = JSON.parse(fs.readFileSync(resultPath, "utf-8"));
    expect(result.status).toBe("completed");
    expect(result.files_changed).toBeInstanceOf(Array);
    expect(result.files_changed).toContain("existing.txt");
    expect(result.files_changed).toContain("added.txt");
  });

  it("sets files_changed to null for non-git workspace", async () => {
    const engine = new ClaudeCodeEngine({
      command: "echo",
      defaultArgs: ["done"],
    });
    const runner = new TaskRunner(runManager, sessionManager, engine);
    const runId = await runManager.createRun({
      task_id: "task-nongit",
      intent: "coding",
      workspace_path: workspaceDir,
      message: "No git",
      engine: "claude-code",
      mode: "new",
    });

    await runner.processRun(runId);

    const resultPath = path.join(runsDir, runId, "result.json");
    const result = JSON.parse(fs.readFileSync(resultPath, "utf-8"));
    expect(result.status).toBe("completed");
    expect(result.files_changed).toBeNull();
  });

  it("includes suggestion in error results", async () => {
    const engine = new ClaudeCodeEngine({ command: "false" });
    const runner = new TaskRunner(runManager, sessionManager, engine);
    const runId = await runManager.createRun({
      task_id: "task-sug",
      intent: "coding",
      workspace_path: workspaceDir,
      message: "Will fail",
      engine: "claude-code",
      mode: "new",
    });

    await runner.processRun(runId);

    const resultPath = path.join(runsDir, runId, "result.json");
    const result = JSON.parse(fs.readFileSync(resultPath, "utf-8"));
    expect(result.status).toBe("failed");
    expect(result.error.suggestion).toBeTruthy();
  });

  it("writes output.txt with full content on success", async () => {
    const engine = new ClaudeCodeEngine({
      command: "echo",
      defaultArgs: ["task completed successfully"],
    });
    const runner = new TaskRunner(runManager, sessionManager, engine);
    const runId = await runManager.createRun({
      task_id: "task-out",
      intent: "coding",
      workspace_path: workspaceDir,
      message: "Test output file",
      engine: "claude-code",
      mode: "new",
    });

    await runner.processRun(runId);

    const outputPath = path.join(runsDir, runId, "output.txt");
    expect(fs.existsSync(outputPath)).toBe(true);
    const outputContent = fs.readFileSync(outputPath, "utf-8");
    expect(outputContent).toContain("task completed successfully");

    const resultPath = path.join(runsDir, runId, "result.json");
    const result = JSON.parse(fs.readFileSync(resultPath, "utf-8"));
    expect(result.output_path).toBe("output.txt");
    expect(result.summary_truncated).toBe(false);
  });

  it("truncates summary at 4000 chars and sets summary_truncated", async () => {
    const longOutput = "A".repeat(5000);
    const engine = new ClaudeCodeEngine({
      command: "printf",
      defaultArgs: [longOutput],
    });
    const runner = new TaskRunner(runManager, sessionManager, engine);
    const runId = await runManager.createRun({
      task_id: "task-trunc",
      intent: "coding",
      workspace_path: workspaceDir,
      message: "Test truncation",
      engine: "claude-code",
      mode: "new",
    });

    await runner.processRun(runId);

    const resultPath = path.join(runsDir, runId, "result.json");
    const result = JSON.parse(fs.readFileSync(resultPath, "utf-8"));
    expect(result.summary.length).toBe(4000);
    expect(result.summary_truncated).toBe(true);

    const outputPath = path.join(runsDir, runId, "output.txt");
    const fullOutput = fs.readFileSync(outputPath, "utf-8");
    expect(fullOutput.length).toBe(5000);
  });

  it("does not truncate summary at exactly 4000 chars", async () => {
    const exactOutput = "B".repeat(4000);
    const engine = new ClaudeCodeEngine({
      command: "printf",
      defaultArgs: [exactOutput],
    });
    const runner = new TaskRunner(runManager, sessionManager, engine);
    const runId = await runManager.createRun({
      task_id: "task-exact",
      intent: "coding",
      workspace_path: workspaceDir,
      message: "Test boundary",
      engine: "claude-code",
      mode: "new",
    });

    await runner.processRun(runId);

    const resultPath = path.join(runsDir, runId, "result.json");
    const result = JSON.parse(fs.readFileSync(resultPath, "utf-8"));
    expect(result.summary.length).toBe(4000);
    expect(result.summary_truncated).toBe(false);
  });

  it("truncates summary at 4001 chars", async () => {
    const output4001 = "C".repeat(4001);
    const engine = new ClaudeCodeEngine({
      command: "printf",
      defaultArgs: [output4001],
    });
    const runner = new TaskRunner(runManager, sessionManager, engine);
    const runId = await runManager.createRun({
      task_id: "task-4001",
      intent: "coding",
      workspace_path: workspaceDir,
      message: "Test 4001",
      engine: "claude-code",
      mode: "new",
    });

    await runner.processRun(runId);

    const resultPath = path.join(runsDir, runId, "result.json");
    const result = JSON.parse(fs.readFileSync(resultPath, "utf-8"));
    expect(result.summary.length).toBe(4000);
    expect(result.summary_truncated).toBe(true);
  });

  it("handles empty engine output", async () => {
    const engine = new ClaudeCodeEngine({
      command: "printf",
      defaultArgs: [""],
    });
    const runner = new TaskRunner(runManager, sessionManager, engine);
    const runId = await runManager.createRun({
      task_id: "task-empty",
      intent: "coding",
      workspace_path: workspaceDir,
      message: "Test empty",
      engine: "claude-code",
      mode: "new",
    });

    await runner.processRun(runId);

    const resultPath = path.join(runsDir, runId, "result.json");
    const result = JSON.parse(fs.readFileSync(resultPath, "utf-8"));
    expect(result.summary).toBe("");
    expect(result.summary_truncated).toBe(false);
    expect(result.output_path).toBe("output.txt");

    const outputPath = path.join(runsDir, runId, "output.txt");
    expect(fs.existsSync(outputPath)).toBe(true);
    expect(fs.readFileSync(outputPath, "utf-8")).toBe("");
  });

  it("includes output_path and summary_truncated in failure result", async () => {
    const engine = new ClaudeCodeEngine({ command: "false" });
    const runner = new TaskRunner(runManager, sessionManager, engine);
    const runId = await runManager.createRun({
      task_id: "task-fail-out",
      intent: "coding",
      workspace_path: workspaceDir,
      message: "Will fail",
      engine: "claude-code",
      mode: "new",
    });

    await runner.processRun(runId);

    const resultPath = path.join(runsDir, runId, "result.json");
    const result = JSON.parse(fs.readFileSync(resultPath, "utf-8"));
    expect(result.status).toBe("failed");
    expect(result.output_path).toBeNull();
    expect(result.summary_truncated).toBe(false);

    const outputPath = path.join(runsDir, runId, "output.txt");
    expect(fs.existsSync(outputPath)).toBe(false);
  });

  it("still writes result.json when writeOutputFile throws", async () => {
    const engine = new ClaudeCodeEngine({
      command: "echo",
      defaultArgs: ["output content"],
    });
    const runner = new TaskRunner(runManager, sessionManager, engine);
    const runId = await runManager.createRun({
      task_id: "task-write-fail",
      intent: "coding",
      workspace_path: workspaceDir,
      message: "Test write failure",
      engine: "claude-code",
      mode: "new",
    });

    // Make the run directory read-only so writeOutputFile fails
    const runDir = path.join(runsDir, runId);
    // Remove write permission after request is consumed but before processRun writes output
    // We achieve this by replacing writeOutputFile with a throwing stub
    const origWriteOutputFile = runManager.writeOutputFile.bind(runManager);
    runManager.writeOutputFile = () => {
      throw new Error("Disk full");
    };

    await runner.processRun(runId);

    // Restore original method
    runManager.writeOutputFile = origWriteOutputFile;

    const resultPath = path.join(runDir, "result.json");
    expect(fs.existsSync(resultPath)).toBe(true);
    const result = JSON.parse(fs.readFileSync(resultPath, "utf-8"));
    expect(result.status).toBe("failed");
    expect(result.error.code).toBe("OUTPUT_WRITE_FAILED");
    expect(result.output_path).toBeNull();
    expect(result.summary_truncated).toBe(false);
  });
});

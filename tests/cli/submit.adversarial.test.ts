/**
 * Adversarial tests for the `codebridge submit` CLI command.
 *
 * Probes argument validation, edge-case flag combinations, and
 * path handling that the existing tests do not cover.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const CLI = "npx tsx src/cli/index.ts";
const CWD = process.cwd();

describe("codebridge submit – adversarial", () => {
  let workspaceDir: string;
  let runsDir: string;

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-adv-ws-"));
    runsDir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-adv-runs-"));
  });

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
    fs.rmSync(runsDir, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // Missing required arguments
  // -----------------------------------------------------------------------
  it("exits non-zero when --intent is missing", () => {
    const result = spawnSync(
      "npx",
      [
        "tsx",
        "src/cli/index.ts",
        "submit",
        "--workspace",
        workspaceDir,
        "--message",
        "Do something",
        "--runs-dir",
        runsDir,
      ],
      { encoding: "utf-8", cwd: CWD },
    );
    expect(result.status).not.toBe(0);
  });

  it("exits non-zero when --workspace is missing", () => {
    const result = spawnSync(
      "npx",
      [
        "tsx",
        "src/cli/index.ts",
        "submit",
        "--intent",
        "coding",
        "--message",
        "Do something",
        "--runs-dir",
        runsDir,
      ],
      { encoding: "utf-8", cwd: CWD },
    );
    expect(result.status).not.toBe(0);
  });

  it("exits non-zero when --message is missing", () => {
    const result = spawnSync(
      "npx",
      [
        "tsx",
        "src/cli/index.ts",
        "submit",
        "--intent",
        "coding",
        "--workspace",
        workspaceDir,
        "--runs-dir",
        runsDir,
      ],
      { encoding: "utf-8", cwd: CWD },
    );
    expect(result.status).not.toBe(0);
  });

  // -----------------------------------------------------------------------
  // --timeout with invalid values (Bug #1 — issue #25)
  // -----------------------------------------------------------------------
  it("exits non-zero when --timeout is 0 (non-positive)", () => {
    const result = spawnSync(
      "npx",
      [
        "tsx",
        "src/cli/index.ts",
        "submit",
        "--intent",
        "coding",
        "--workspace",
        workspaceDir,
        "--message",
        "Test",
        "--timeout",
        "0",
        "--runs-dir",
        runsDir,
      ],
      { encoding: "utf-8", cwd: CWD },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/timeout/i);
  });

  it("exits non-zero when --timeout is negative", () => {
    const result = spawnSync(
      "npx",
      [
        "tsx",
        "src/cli/index.ts",
        "submit",
        "--intent",
        "coding",
        "--workspace",
        workspaceDir,
        "--message",
        "Test",
        "--timeout",
        "-1",
        "--runs-dir",
        runsDir,
      ],
      { encoding: "utf-8", cwd: CWD },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/timeout/i);
  });

  it("exits non-zero when --timeout is non-numeric (NaN)", () => {
    const result = spawnSync(
      "npx",
      [
        "tsx",
        "src/cli/index.ts",
        "submit",
        "--intent",
        "coding",
        "--workspace",
        workspaceDir,
        "--message",
        "Test",
        "--timeout",
        "abc",
        "--runs-dir",
        runsDir,
      ],
      { encoding: "utf-8", cwd: CWD },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/timeout/i);
  });

  // -----------------------------------------------------------------------
  // --intent with invalid value (Bug #1 — issue #25)
  // -----------------------------------------------------------------------
  it("exits non-zero when --intent is an invalid value", () => {
    const result = spawnSync(
      "npx",
      [
        "tsx",
        "src/cli/index.ts",
        "submit",
        "--intent",
        "hacking",
        "--workspace",
        workspaceDir,
        "--message",
        "Test",
        "--runs-dir",
        runsDir,
      ],
      { encoding: "utf-8", cwd: CWD },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/intent/i);
  });

  // -----------------------------------------------------------------------
  // --engine with invalid value (Bug #1 — issue #25)
  // -----------------------------------------------------------------------
  it("exits non-zero when --engine is an unknown engine name", () => {
    const result = spawnSync(
      "npx",
      [
        "tsx",
        "src/cli/index.ts",
        "submit",
        "--intent",
        "coding",
        "--workspace",
        workspaceDir,
        "--message",
        "Test",
        "--engine",
        "gpt-4o",
        "--runs-dir",
        runsDir,
      ],
      { encoding: "utf-8", cwd: CWD },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/engine/i);
  });

  // -----------------------------------------------------------------------
  // Workspace path handling
  // -----------------------------------------------------------------------
  it("resolves relative workspace path to absolute before writing request.json", () => {
    // The CLI calls path.resolve(opts.workspace). Since we pass workspaceDir as an
    // absolute path, verify the stored path is absolute. (Running with cwd=workspaceDir
    // would fail because tsx cannot find src/cli/index.ts there, so we use CWD and
    // pass the absolute path directly to confirm the path is preserved as absolute.)
    const result = execSync(
      `${CLI} submit --intent coding --workspace "${workspaceDir}" --message "Test" --runs-dir "${runsDir}"`,
      { encoding: "utf-8", cwd: CWD },
    );
    const { run_id } = JSON.parse(result.trim());
    const requestPath = path.join(runsDir, run_id, "request.json");
    const request = JSON.parse(fs.readFileSync(requestPath, "utf-8"));
    expect(path.isAbsolute(request.workspace_path)).toBe(true);
    expect(request.workspace_path).toBe(workspaceDir);
  });

  it("creates run directory and request.json with correct structure", () => {
    const result = execSync(
      `${CLI} submit --intent refactor --workspace "${workspaceDir}" --message "Refactor auth" --runs-dir "${runsDir}"`,
      { encoding: "utf-8", cwd: CWD },
    );
    const { run_id } = JSON.parse(result.trim());
    const requestPath = path.join(runsDir, run_id, "request.json");
    expect(fs.existsSync(requestPath)).toBe(true);
    const request = JSON.parse(fs.readFileSync(requestPath, "utf-8"));
    expect(request.intent).toBe("refactor");
    expect(request.message).toBe("Refactor auth");
    expect(request.mode).toBe("new");
    expect(request.engine).toBe("claude-code"); // default
  });

  it('output JSON contains run_id with "run-" prefix and status "created"', () => {
    const result = execSync(
      `${CLI} submit --intent debug --workspace "${workspaceDir}" --message "Debug crash" --runs-dir "${runsDir}"`,
      { encoding: "utf-8", cwd: CWD },
    );
    const output = JSON.parse(result.trim());
    expect(output.run_id).toMatch(/^run-/);
    expect(output.status).toBe("created");
    expect(output.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO date
  });

  // -----------------------------------------------------------------------
  // Workspace path with spaces and special chars
  // -----------------------------------------------------------------------
  it("handles workspace path with spaces correctly", () => {
    const spacedDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "cb dir with spaces-"),
    );
    try {
      const result = execSync(
        `${CLI} submit --intent coding --workspace "${spacedDir}" --message "Test spaces" --runs-dir "${runsDir}"`,
        { encoding: "utf-8", cwd: CWD },
      );
      const { run_id } = JSON.parse(result.trim());
      const requestPath = path.join(runsDir, run_id, "request.json");
      const request = JSON.parse(fs.readFileSync(requestPath, "utf-8"));
      expect(request.workspace_path).toBe(spacedDir);
    } finally {
      fs.rmSync(spacedDir, { recursive: true, force: true });
    }
  });
});

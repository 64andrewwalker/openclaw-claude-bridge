/**
 * Adversarial tests for the `codebridge resume` CLI command.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const CLI = "npx tsx src/cli/index.ts";
const CWD = process.cwd();

describe("codebridge resume – adversarial", () => {
  let workspaceDir: string;
  let runsDir: string;

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-resumeadv-ws-"));
    runsDir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-resumeadv-runs-"));
  });

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
    fs.rmSync(runsDir, { recursive: true, force: true });
  });

  function submitAndComplete(intent = "coding"): string {
    const submitOut = execSync(
      `${CLI} submit --intent ${intent} --workspace "${workspaceDir}" --message "Initial task" --runs-dir "${runsDir}"`,
      { encoding: "utf-8", cwd: CWD },
    );
    const { run_id } = JSON.parse(submitOut.trim());
    const runDir = path.join(runsDir, run_id);

    // Simulate task processed: consume request, mark completed with a session_id
    fs.renameSync(
      path.join(runDir, "request.json"),
      path.join(runDir, "request.processing.json"),
    );
    const session = JSON.parse(
      fs.readFileSync(path.join(runDir, "session.json"), "utf-8"),
    );
    session.state = "completed";
    session.session_id = "sess-adv-test-123";
    fs.writeFileSync(
      path.join(runDir, "session.json"),
      JSON.stringify(session),
    );
    return run_id;
  }

  // -----------------------------------------------------------------------
  // Missing required arguments
  // -----------------------------------------------------------------------
  it("exits non-zero when --message is missing", () => {
    const run_id = submitAndComplete();
    const result = spawnSync(
      "npx",
      ["tsx", "src/cli/index.ts", "resume", run_id, "--runs-dir", runsDir],
      { encoding: "utf-8", cwd: CWD },
    );
    expect(result.status).not.toBe(0);
  });

  it("exits non-zero when run_id argument is missing", () => {
    const result = spawnSync(
      "npx",
      [
        "tsx",
        "src/cli/index.ts",
        "resume",
        "--message",
        "follow up",
        "--runs-dir",
        runsDir,
      ],
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
        "resume",
        "run-doesnotexist",
        "--message",
        "follow up",
        "--runs-dir",
        runsDir,
      ],
      { encoding: "utf-8", cwd: CWD },
    );
    expect(result.status).not.toBe(0);
  });

  // -----------------------------------------------------------------------
  // Bug #2 (issue #25): intent must be preserved from original request
  // -----------------------------------------------------------------------
  it("resume preserves original intent from request.processing.json, not hardcoded 'coding'", () => {
    // submitAndComplete uses intent='refactor'; resume must carry that through
    const run_id = submitAndComplete("refactor");
    const runDir = path.join(runsDir, run_id);

    execSync(
      `${CLI} resume ${run_id} --message "Follow up" --runs-dir "${runsDir}"`,
      { encoding: "utf-8", cwd: CWD },
    );

    const newRequest = JSON.parse(
      fs.readFileSync(path.join(runDir, "request.json"), "utf-8"),
    );
    // Fix: resume must read intent from request.processing.json, not hardcode 'coding'
    expect(newRequest.intent).toBe("refactor");
  });

  // -----------------------------------------------------------------------
  // Bug #3 (issue #25): missing request.processing.json must be a hard error
  // -----------------------------------------------------------------------
  it("exits non-zero when request.processing.json is missing instead of silently using cwd", () => {
    const run_id = submitAndComplete();
    const runDir = path.join(runsDir, run_id);

    // Remove request.processing.json so the fallback would previously trigger
    fs.rmSync(path.join(runDir, "request.processing.json"));

    const result = spawnSync(
      "npx",
      [
        "tsx",
        "src/cli/index.ts",
        "resume",
        run_id,
        "--message",
        "Follow up",
        "--runs-dir",
        runsDir,
      ],
      { encoding: "utf-8", cwd: CWD },
    );
    // Fix: must exit non-zero rather than silently using process.cwd()
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/request\.processing\.json/i);
  });

  // -----------------------------------------------------------------------
  // Resume output structure
  // -----------------------------------------------------------------------
  it('resume outputs run_id, status="resume_queued", and session_id', () => {
    const run_id = submitAndComplete();

    const result = execSync(
      `${CLI} resume ${run_id} --message "Follow up" --runs-dir "${runsDir}"`,
      { encoding: "utf-8", cwd: CWD },
    );
    const output = JSON.parse(result.trim());
    expect(output.run_id).toBe(run_id);
    expect(output.status).toBe("resume_queued");
    expect(output.session_id).toBe("sess-adv-test-123");
  });

  // -----------------------------------------------------------------------
  // Resume a run with no session_id should throw
  // -----------------------------------------------------------------------
  it("exits non-zero when run has no session_id", () => {
    const submitOut = execSync(
      `${CLI} submit --intent coding --workspace "${workspaceDir}" --message "No session" --runs-dir "${runsDir}"`,
      { encoding: "utf-8", cwd: CWD },
    );
    const { run_id } = JSON.parse(submitOut.trim());
    const runDir = path.join(runsDir, run_id);

    // Simulate completion but with null session_id
    fs.renameSync(
      path.join(runDir, "request.json"),
      path.join(runDir, "request.processing.json"),
    );
    const session = JSON.parse(
      fs.readFileSync(path.join(runDir, "session.json"), "utf-8"),
    );
    session.state = "completed";
    session.session_id = null; // No session_id
    fs.writeFileSync(
      path.join(runDir, "session.json"),
      JSON.stringify(session),
    );

    const result = spawnSync(
      "npx",
      [
        "tsx",
        "src/cli/index.ts",
        "resume",
        run_id,
        "--message",
        "Follow up",
        "--runs-dir",
        runsDir,
      ],
      { encoding: "utf-8", cwd: CWD },
    );
    expect(result.status).not.toBe(0);
  });
});

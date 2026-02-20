import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const CLI = 'npx tsx src/cli/index.ts';
const CWD = process.cwd();

describe('codebridge resume', () => {
  let workspaceDir: string;
  let runsDir: string;

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-resume-ws-'));
    runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-resume-runs-'));
  });

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
    fs.rmSync(runsDir, { recursive: true, force: true });
  });

  function createFakeClaudeBin(): string {
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-fake-claude-'));
    const scriptPath = path.join(binDir, 'claude');
    fs.writeFileSync(
      scriptPath,
      `#!/usr/bin/env bash
echo '{"result":"resume wait ok","session_id":"sess-test-123","usage":{"input_tokens":2,"output_tokens":3}}'
`,
    );
    fs.chmodSync(scriptPath, 0o755);
    return binDir;
  }

  it('resume preserves original workspace_path', () => {
    // Submit first
    const submitOut = execSync(
      `${CLI} submit --intent coding --workspace "${workspaceDir}" --message "Initial task" --runs-dir "${runsDir}"`,
      { encoding: 'utf-8', cwd: CWD }
    );
    const { run_id } = JSON.parse(submitOut.trim());

    // Simulate that the task was processed (consume request, mark completed)
    const runDir = path.join(runsDir, run_id);
    // request.json already exists, rename to processing to simulate consumption
    fs.renameSync(path.join(runDir, 'request.json'), path.join(runDir, 'request.processing.json'));
    // Update session to completed
    const session = JSON.parse(fs.readFileSync(path.join(runDir, 'session.json'), 'utf-8'));
    session.state = 'completed';
    session.session_id = 'sess-test-123';
    fs.writeFileSync(path.join(runDir, 'session.json'), JSON.stringify(session));

    // Resume
    const resumeOut = execSync(
      `${CLI} resume ${run_id} --message "Now add tests" --runs-dir "${runsDir}"`,
      { encoding: 'utf-8', cwd: CWD }
    );
    const output = JSON.parse(resumeOut.trim());
    expect(output.status).toBe('resume_queued');

    // Check the new request.json uses original workspace, not cwd
    const newRequest = JSON.parse(fs.readFileSync(path.join(runDir, 'request.json'), 'utf-8'));
    expect(newRequest.workspace_path).toBe(workspaceDir);
    expect(newRequest.mode).toBe('resume');
    expect(newRequest.session_id).toBe('sess-test-123');
  });

  it('submit passes --timeout to request constraints', () => {
    const submitOut = execSync(
      `${CLI} submit --intent coding --workspace "${workspaceDir}" --message "Fast task" --timeout 5000 --runs-dir "${runsDir}"`,
      { encoding: 'utf-8', cwd: CWD }
    );
    const { run_id } = JSON.parse(submitOut.trim());

    const requestPath = path.join(runsDir, run_id, 'request.json');
    const request = JSON.parse(fs.readFileSync(requestPath, 'utf-8'));
    expect(request.constraints.timeout_ms).toBe(5000);
  });

  it('resume --wait processes immediately and returns result JSON', () => {
    const submitOut = execSync(
      `${CLI} submit --intent coding --workspace "${workspaceDir}" --message "Initial task" --runs-dir "${runsDir}"`,
      { encoding: 'utf-8', cwd: CWD }
    );
    const { run_id } = JSON.parse(submitOut.trim());
    const runDir = path.join(runsDir, run_id);

    fs.renameSync(path.join(runDir, 'request.json'), path.join(runDir, 'request.processing.json'));
    const session = JSON.parse(fs.readFileSync(path.join(runDir, 'session.json'), 'utf-8'));
    session.state = 'completed';
    session.session_id = 'sess-test-123';
    fs.writeFileSync(path.join(runDir, 'session.json'), JSON.stringify(session));

    const fakeBin = createFakeClaudeBin();
    const env = { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` };
    const resumeOut = execSync(
      `${CLI} resume ${run_id} --wait --message "Now add tests" --runs-dir "${runsDir}"`,
      { encoding: 'utf-8', cwd: CWD, env }
    );
    const output = JSON.parse(resumeOut.trim());
    expect(output.status).toBe('completed');
    expect(output.summary).toContain('resume wait ok');
    expect(output.session_id).toBe('sess-test-123');
    fs.rmSync(fakeBin, { recursive: true, force: true });
  });

  it('rejects resume when run is still running', () => {
    const submitOut = execSync(
      `${CLI} submit --intent coding --workspace "${workspaceDir}" --message "Initial task" --runs-dir "${runsDir}"`,
      { encoding: 'utf-8', cwd: CWD }
    );
    const { run_id } = JSON.parse(submitOut.trim());
    const runDir = path.join(runsDir, run_id);

    const session = JSON.parse(fs.readFileSync(path.join(runDir, 'session.json'), 'utf-8'));
    session.state = 'running';
    session.session_id = 'sess-running-1';
    fs.writeFileSync(path.join(runDir, 'session.json'), JSON.stringify(session));

    expect(() => {
      execSync(
        `${CLI} resume ${run_id} --message "Now add tests" --runs-dir "${runsDir}"`,
        { encoding: 'utf-8', cwd: CWD, stdio: 'pipe' }
      );
    }).toThrow();
  });
});

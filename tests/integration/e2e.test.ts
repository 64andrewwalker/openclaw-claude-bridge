import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const CLI = 'npx tsx src/cli/index.ts';
const CWD = process.cwd();

describe('E2E: codebridge CLI', () => {
  let workspaceDir: string;
  let runsDir: string;

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-e2e-ws-'));
    runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-e2e-runs-'));
    fs.writeFileSync(path.join(workspaceDir, 'hello.txt'), 'hello world');
  });

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
    fs.rmSync(runsDir, { recursive: true, force: true });
  });

  it('submit (no-wait) creates run and returns JSON', () => {
    const stdout = execSync(
      `${CLI} submit --intent coding --workspace "${workspaceDir}" --message "Test task" --runs-dir "${runsDir}"`,
      { encoding: 'utf-8', cwd: CWD }
    );
    const output = JSON.parse(stdout.trim());
    expect(output.run_id).toMatch(/^run-/);
    expect(output.status).toBe('created');
    expect(output.created_at).toBeDefined();

    // Verify files on disk
    const runDir = path.join(runsDir, output.run_id);
    expect(fs.existsSync(path.join(runDir, 'request.json'))).toBe(true);
    expect(fs.existsSync(path.join(runDir, 'session.json'))).toBe(true);
    expect(fs.existsSync(path.join(runDir, 'context'))).toBe(true);
    expect(fs.existsSync(path.join(runDir, 'logs'))).toBe(true);
    expect(fs.existsSync(path.join(runDir, 'artifacts'))).toBe(true);
  });

  it('status returns session state after submit', () => {
    const submitOut = execSync(
      `${CLI} submit --intent coding --workspace "${workspaceDir}" --message "Test" --runs-dir "${runsDir}"`,
      { encoding: 'utf-8', cwd: CWD }
    );
    const { run_id } = JSON.parse(submitOut.trim());

    const statusOut = execSync(
      `${CLI} status ${run_id} --runs-dir "${runsDir}"`,
      { encoding: 'utf-8', cwd: CWD }
    );
    const session = JSON.parse(statusOut.trim());
    expect(session.state).toBe('created');
    expect(session.engine).toBe('claude-code');
    expect(session.run_id).toBe(run_id);
  });

  it('doctor outputs diagnostic checks', () => {
    const stdout = execSync(
      `${CLI} doctor --runs-dir "${runsDir}"`,
      { encoding: 'utf-8', cwd: CWD }
    );
    const output = JSON.parse(stdout.trim());
    expect(output.checks).toBeInstanceOf(Array);
    expect(output.checks.find((c: { name: string }) => c.name === 'Node.js')).toBeDefined();
    expect(output.checks.find((c: { name: string }) => c.name === 'Runs directory')).toBeDefined();
  });

  it('submit + status round-trip preserves request data', () => {
    const submitOut = execSync(
      `${CLI} submit --intent refactor --workspace "${workspaceDir}" --message "Refactor auth" --runs-dir "${runsDir}" --engine claude-code`,
      { encoding: 'utf-8', cwd: CWD }
    );
    const { run_id } = JSON.parse(submitOut.trim());

    // Read request.json directly to verify data integrity
    const requestPath = path.join(runsDir, run_id, 'request.json');
    const request = JSON.parse(fs.readFileSync(requestPath, 'utf-8'));
    expect(request.intent).toBe('refactor');
    expect(request.message).toBe('Refactor auth');
    expect(request.engine).toBe('claude-code');
    expect(request.mode).toBe('new');
  });

  it('logs command works on a fresh run', () => {
    const submitOut = execSync(
      `${CLI} submit --intent coding --workspace "${workspaceDir}" --message "Test" --runs-dir "${runsDir}"`,
      { encoding: 'utf-8', cwd: CWD }
    );
    const { run_id } = JSON.parse(submitOut.trim());

    const logsOut = execSync(
      `${CLI} logs ${run_id} --runs-dir "${runsDir}"`,
      { encoding: 'utf-8', cwd: CWD }
    );
    expect(logsOut).toContain('No log files yet');
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const CWD = process.cwd();

describe('codebridge submit', () => {
  let workspaceDir: string;
  let runsDir: string;

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-ws-'));
    runsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-runs-'));
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
echo '{"result":"submit wait ok","session_id":"sess-submit-wait","usage":{"input_tokens":3,"output_tokens":4}}'
`,
    );
    fs.chmodSync(scriptPath, 0o755);
    return binDir;
  }

  it('creates a run and outputs JSON with run_id (no-wait)', () => {
    const result = execSync(
      `npx tsx src/cli/index.ts submit --intent coding --workspace "${workspaceDir}" --message "Add login" --runs-dir "${runsDir}"`,
      { encoding: 'utf-8', cwd: CWD }
    );
    const output = JSON.parse(result.trim());
    expect(output.run_id).toMatch(/^run-/);
    expect(output.status).toBe('created');
    const runDir = path.join(runsDir, output.run_id);
    expect(fs.existsSync(runDir)).toBe(true);
  });

  it('submit --wait blocks and returns full result', () => {
    const fakeBin = createFakeClaudeBin();
    const env = { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` };
    const result = execSync(
      `npx tsx src/cli/index.ts submit --wait --intent coding --workspace "${workspaceDir}" --message "Add login" --runs-dir "${runsDir}"`,
      { encoding: 'utf-8', cwd: CWD, env }
    );
    const output = JSON.parse(result.trim());
    expect(output.status).toBe('completed');
    expect(output.summary).toContain('submit wait ok');
    expect(output.session_id).toBe('sess-submit-wait');
    expect(output.token_usage.total_tokens).toBe(7);
    fs.rmSync(fakeBin, { recursive: true, force: true });
  });
});

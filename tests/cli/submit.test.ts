import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

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

  it('creates a run and outputs JSON with run_id (no-wait)', () => {
    const result = execSync(
      `npx tsx src/cli/index.ts submit --intent coding --workspace "${workspaceDir}" --message "Add login" --runs-dir "${runsDir}"`,
      { encoding: 'utf-8', cwd: '/Volumes/DevWork/infra/openclaw-claude-bridge' }
    );
    const output = JSON.parse(result.trim());
    expect(output.run_id).toMatch(/^run-/);
    expect(output.status).toBe('created');
    const runDir = path.join(runsDir, output.run_id);
    expect(fs.existsSync(runDir)).toBe(true);
  });
});

import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';

const CWD = process.cwd();

describe('codebridge doctor', () => {
  it('outputs diagnostic checks as JSON', () => {
    const result = execSync(
      'npx tsx src/cli/index.ts doctor',
      { encoding: 'utf-8', cwd: CWD }
    );
    const output = JSON.parse(result.trim());
    expect(output.checks).toBeInstanceOf(Array);
    expect(output.checks.length).toBeGreaterThan(0);
    expect(output.checks[0]).toHaveProperty('name');
    expect(output.checks[0]).toHaveProperty('status');
  });
});

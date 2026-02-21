import { Command } from 'commander';
import { execSync } from 'node:child_process';
import { existsSync, accessSync, constants } from 'node:fs';
import path from 'node:path';

interface Check { name: string; status: 'ok' | 'warn' | 'fail'; detail: string; }

export function doctorCommand(): Command {
  return new Command('doctor')
    .description('Diagnose environment issues')
    .option('--runs-dir <path>', 'Runs directory', path.join(process.cwd(), '.runs'))
    .action(async (opts) => {
      const checks: Check[] = [];
      const nodeVersion = process.version;
      checks.push({ name: 'Node.js', status: parseInt(nodeVersion.slice(1)) >= 18 ? 'ok' : 'warn', detail: nodeVersion });

      const extraBins = [
        '/opt/homebrew/bin',
        '/usr/local/bin',
        '/usr/bin',
      ];
      const home = process.env.HOME;
      if (home) {
        extraBins.push(path.join(home, '.local', 'bin'));
        extraBins.push(path.join(home, '.npm-global', 'bin'));
      }
      const mergedPath = [...new Set([...extraBins, ...(process.env.PATH ?? '').split(':').filter(Boolean)])].join(':');

      try {
        const claudeVersion = execSync('claude --version 2>/dev/null', {
          encoding: 'utf-8',
          env: { ...process.env, PATH: mergedPath },
        }).trim();
        checks.push({ name: 'Claude CLI', status: 'ok', detail: claudeVersion });
      } catch {
        checks.push({ name: 'Claude CLI', status: 'fail', detail: 'Not found in PATH (or common bin paths)' });
      }
      try {
        const kimiVersion = execSync('kimi --version 2>/dev/null', {
          encoding: 'utf-8',
          env: { ...process.env, PATH: mergedPath },
        }).trim();
        checks.push({ name: 'Kimi CLI', status: 'ok', detail: kimiVersion });
      } catch {
        checks.push({ name: 'Kimi CLI', status: 'warn', detail: 'Not found in PATH (optional: needed for kimi-code engine)' });
      }
      try {
        if (existsSync(opts.runsDir)) {
          accessSync(opts.runsDir, constants.W_OK);
          checks.push({ name: 'Runs directory', status: 'ok', detail: opts.runsDir });
        } else {
          checks.push({ name: 'Runs directory', status: 'warn', detail: `${opts.runsDir} (will be created)` });
        }
      } catch {
        checks.push({ name: 'Runs directory', status: 'fail', detail: `${opts.runsDir} (not writable)` });
      }
      process.stdout.write(JSON.stringify({ checks }, null, 2) + '\n');
    });
}

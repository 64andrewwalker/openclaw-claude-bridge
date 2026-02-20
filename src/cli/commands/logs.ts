import { Command } from 'commander';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

export function logsCommand(): Command {
  return new Command('logs')
    .description('View logs for a run')
    .argument('<run_id>', 'Run ID')
    .option('--runs-dir <path>', 'Runs directory', path.join(process.cwd(), '.runs'))
    .action(async (runId, opts) => {
      const logsDir = path.join(opts.runsDir, runId, 'logs');
      if (!existsSync(logsDir)) {
        process.stderr.write(`No logs directory for run ${runId}\n`);
        process.exit(1);
      }
      const files = readdirSync(logsDir);
      for (const file of files) {
        const content = readFileSync(path.join(logsDir, file), 'utf-8');
        process.stdout.write(`=== ${file} ===\n${content}\n`);
      }
      if (files.length === 0) process.stdout.write('No log files yet.\n');
    });
}

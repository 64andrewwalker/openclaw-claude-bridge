import { Command } from 'commander';
import { RunManager } from '../../core/run-manager.js';
import path from 'node:path';

export function statusCommand(): Command {
  return new Command('status')
    .description('Query status of a run')
    .argument('<run_id>', 'Run ID to query')
    .option('--runs-dir <path>', 'Runs directory', path.join(process.cwd(), '.runs'))
    .action(async (runId, opts) => {
      const runManager = new RunManager(opts.runsDir);
      const session = await runManager.getStatus(runId);
      process.stdout.write(JSON.stringify(session, null, 2) + '\n');
    });
}

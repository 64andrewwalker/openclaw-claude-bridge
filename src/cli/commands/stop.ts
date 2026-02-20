import { Command } from 'commander';
import { RunManager } from '../../core/run-manager.js';
import { SessionManager } from '../../core/session-manager.js';
import path from 'node:path';

export function stopCommand(): Command {
  return new Command('stop')
    .description('Stop a running task')
    .argument('<run_id>', 'Run ID to stop')
    .option('--runs-dir <path>', 'Runs directory', path.join(process.cwd(), '.runs'))
    .action(async (runId, opts) => {
      const runManager = new RunManager(opts.runsDir);
      const sessionManager = new SessionManager(runManager);
      const session = await runManager.getStatus(runId);
      if (session.state !== 'running') {
        process.stderr.write(`Run ${runId} is not running (state: ${session.state})\n`);
        process.exit(1);
      }
      await sessionManager.transition(runId, 'stopping');
      if (session.pid) {
        try { process.kill(session.pid, 'SIGTERM'); } catch { /* already dead */ }
      }
      process.stdout.write(JSON.stringify({ run_id: runId, status: 'stopping' }, null, 2) + '\n');
    });
}

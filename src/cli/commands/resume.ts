import { Command } from 'commander';
import { RunManager } from '../../core/run-manager.js';
import path from 'node:path';

export function resumeCommand(): Command {
  return new Command('resume')
    .description('Send follow-up message to an existing session')
    .argument('<run_id>', 'Run ID to resume')
    .requiredOption('--message <text>', 'Follow-up message')
    .option('--wait', 'Block until task completes', false)
    .option('--runs-dir <path>', 'Runs directory', path.join(process.cwd(), '.runs'))
    .action(async (runId, opts) => {
      const runManager = new RunManager(opts.runsDir);
      const session = await runManager.getStatus(runId);
      const { writeFileSync, renameSync } = await import('node:fs');
      const runDir = runManager.getRunDir(runId);
      const request = {
        task_id: session.run_id,
        intent: 'coding',
        workspace_path: process.cwd(),
        message: opts.message,
        engine: session.engine,
        mode: 'resume',
        session_id: session.session_id,
      };
      const tmpPath = path.join(runDir, 'request.tmp');
      const finalPath = path.join(runDir, 'request.json');
      writeFileSync(tmpPath, JSON.stringify(request, null, 2));
      renameSync(tmpPath, finalPath);
      process.stdout.write(JSON.stringify({ run_id: runId, status: 'resume_queued', session_id: session.session_id }, null, 2) + '\n');
    });
}

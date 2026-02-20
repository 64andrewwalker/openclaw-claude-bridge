import { Command } from 'commander';
import { RunManager } from '../../core/run-manager.js';
import { SessionManager } from '../../core/session-manager.js';
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
      const sessionManager = new SessionManager(runManager);
      const session = await runManager.getStatus(runId);
      if (!session.session_id) {
        throw new Error(`Run ${runId} has no session_id and cannot be resumed`);
      }
      const { writeFileSync, renameSync, readFileSync, existsSync } = await import('node:fs');
      const runDir = runManager.getRunDir(runId);

      // Get original workspace from request.processing.json
      let workspacePath = process.cwd();
      const processingPath = path.join(runDir, 'request.processing.json');
      if (existsSync(processingPath)) {
        const original = JSON.parse(readFileSync(processingPath, 'utf-8'));
        workspacePath = original.workspace_path ?? workspacePath;
      }

      const request = {
        task_id: session.run_id,
        intent: 'coding',
        workspace_path: workspacePath,
        message: opts.message,
        engine: session.engine,
        mode: 'resume',
        session_id: session.session_id,
      };
      const tmpPath = path.join(runDir, 'request.tmp');
      const finalPath = path.join(runDir, 'request.json');
      writeFileSync(tmpPath, JSON.stringify(request, null, 2));
      renameSync(tmpPath, finalPath);

      // Reset session state with state guard so running tasks cannot be resumed.
      await sessionManager.resetForResume(runId);

      if (!opts.wait) {
        process.stdout.write(JSON.stringify({ run_id: runId, status: 'resume_queued', session_id: session.session_id }, null, 2) + '\n');
        return;
      }

      // --wait mode: process immediately
      const { resolveEngine } = await import('../../engines/index.js');
      const { TaskRunner } = await import('../../core/runner.js');
      const engine = resolveEngine(session.engine);
      const runner = new TaskRunner(runManager, sessionManager, engine);
      await runner.processRun(runId);
      const result = readFileSync(path.join(opts.runsDir, runId, 'result.json'), 'utf-8');
      process.stdout.write(result + '\n');
    });
}

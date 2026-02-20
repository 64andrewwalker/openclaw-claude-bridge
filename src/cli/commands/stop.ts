import { Command } from 'commander';
import { RunManager } from '../../core/run-manager.js';
import { SessionManager } from '../../core/session-manager.js';
import path from 'node:path';

function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      if (!isProcessAlive(pid)) { resolve(true); return; }
      if (Date.now() - start > timeoutMs) { resolve(false); return; }
      setTimeout(check, 200);
    };
    check();
  });
}

export function stopCommand(): Command {
  return new Command('stop')
    .description('Stop a running task')
    .argument('<run_id>', 'Run ID to stop')
    .option('--runs-dir <path>', 'Runs directory', path.join(process.cwd(), '.runs'))
    .option('--force-timeout <ms>', 'Time to wait for graceful exit before SIGKILL', '5000')
    .action(async (runId, opts) => {
      const runManager = new RunManager(opts.runsDir);
      const sessionManager = new SessionManager(runManager);
      const session = await runManager.getStatus(runId);

      if (session.state !== 'running') {
        process.stderr.write(`Run ${runId} is not running (state: ${session.state})\n`);
        process.exit(1);
      }

      await sessionManager.transition(runId, 'stopping');

      let stopped = true;
      if (session.pid) {
        try { process.kill(session.pid, 'SIGTERM'); } catch { /* already dead */ }
        const exited = await waitForExit(session.pid, parseInt(opts.forceTimeout));
        if (!exited) {
          try { process.kill(session.pid, 'SIGKILL'); } catch { /* already dead */ }
          await waitForExit(session.pid, 2000);
        }
        stopped = !isProcessAlive(session.pid);
      }

      // Transition to completed (force-stopped)
      await sessionManager.transition(runId, 'completed');
      await runManager.writeResult(runId, {
        run_id: runId,
        status: 'completed',
        summary: 'Task force-stopped by user',
        session_id: session.session_id ?? null,
        artifacts: [],
        duration_ms: 0,
        token_usage: null,
      });

      process.stdout.write(JSON.stringify({ run_id: runId, status: 'stopped' }, null, 2) + '\n');
    });
}

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { RunManager } from './run-manager.js';
import { makeError } from '../schemas/errors.js';
import { isProcessAlive } from '../utils/process.js';

export interface ReconcileAction {
  runId: string;
  action: 'marked_failed' | 'marked_completed' | 'kept_running';
  detail: string;
}

export class Reconciler {
  constructor(private runManager: RunManager) {}

  private logAction(action: ReconcileAction, runsDir: string): void {
    const timestamp = new Date().toISOString();
    const line = `${timestamp} [${action.action}] ${action.runId}: ${action.detail}\n`;

    // Global reconciliation log
    const globalLogPath = path.join(runsDir, 'reconciliation.log');
    fs.appendFileSync(globalLogPath, line);

    // Per-run log
    const runLogDir = path.join(this.runManager.getRunDir(action.runId), 'logs');
    if (fs.existsSync(runLogDir)) {
      fs.appendFileSync(path.join(runLogDir, 'reconciliation.log'), line);
    }
  }

  async reconcile(): Promise<ReconcileAction[]> {
    const runs = await this.runManager.listRuns();
    const actions: ReconcileAction[] = [];
    const runsDir = this.runManager.getRunsDir();

    for (const run of runs) {
      if (run.state !== 'running') continue;
      if (run.pid && isProcessAlive(run.pid)) continue;

      const resultPath = path.join(this.runManager.getRunDir(run.run_id), 'result.json');

      if (fs.existsSync(resultPath)) {
        try {
          const result = JSON.parse(fs.readFileSync(resultPath, 'utf-8'));
          const newState = result.status === 'completed' ? 'completed' : 'failed';
          await this.runManager.updateSession(run.run_id, { state: newState });
          const action: ReconcileAction = {
            runId: run.run_id,
            action: newState === 'completed' ? 'marked_completed' : 'marked_failed',
            detail: `Reconciled from result.json (status: ${result.status})`,
          };
          actions.push(action);
          this.logAction(action, runsDir);
          continue;
        } catch {
          // Corrupt result.json is treated as orphaned and rewritten below.
        }
      }

      await this.runManager.updateSession(run.run_id, { state: 'failed' });
      await this.runManager.writeResult(run.run_id, {
        run_id: run.run_id,
        status: 'failed',
        summary: 'Task orphaned after runner restart',
        session_id: run.session_id ?? null,
        artifacts: [],
        duration_ms: 0,
        token_usage: null,
        error: makeError('RUNNER_CRASH_RECOVERY'),
      });
      const action: ReconcileAction = {
        runId: run.run_id,
        action: 'marked_failed',
        detail: `Orphaned task (pid ${run.pid} no longer running, missing/corrupt result.json)`,
      };
      actions.push(action);
      this.logAction(action, runsDir);
    }

    return actions;
  }
}

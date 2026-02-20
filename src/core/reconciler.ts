import * as fs from 'node:fs';
import * as path from 'node:path';
import type { RunManager } from './run-manager.js';
import { makeError } from '../schemas/errors.js';

export interface ReconcileAction {
  runId: string;
  action: 'marked_failed' | 'marked_completed' | 'kept_running';
  detail: string;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export class Reconciler {
  constructor(private runManager: RunManager) {}

  async reconcile(): Promise<ReconcileAction[]> {
    const runs = await this.runManager.listRuns();
    const actions: ReconcileAction[] = [];

    for (const run of runs) {
      if (run.state !== 'running') continue;
      if (run.pid && isProcessAlive(run.pid)) continue;

      const resultPath = path.join(this.runManager.getRunDir(run.run_id), 'result.json');

      if (fs.existsSync(resultPath)) {
        const result = JSON.parse(fs.readFileSync(resultPath, 'utf-8'));
        const newState = result.status === 'completed' ? 'completed' : 'failed';
        await this.runManager.updateSession(run.run_id, { state: newState });
        actions.push({
          runId: run.run_id,
          action: newState === 'completed' ? 'marked_completed' : 'marked_failed',
          detail: `Reconciled from result.json (status: ${result.status})`,
        });
      } else {
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
        actions.push({
          runId: run.run_id,
          action: 'marked_failed',
          detail: `Orphaned task (pid ${run.pid} no longer running, no result.json)`,
        });
      }
    }

    return actions;
  }
}

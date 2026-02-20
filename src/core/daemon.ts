import { RunManager } from './run-manager.js';
import { SessionManager } from './session-manager.js';
import { TaskRunner } from './runner.js';
import { Reconciler } from './reconciler.js';
import type { Engine } from './engine.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

export class Daemon {
  private runManager: RunManager;
  private sessionManager: SessionManager;
  private runner: TaskRunner;
  private reconciler: Reconciler;
  private pollInterval: NodeJS.Timeout | null = null;
  private processing = new Set<string>();

  constructor(runsDir: string, engine: Engine, private intervalMs = 2000) {
    this.runManager = new RunManager(runsDir);
    this.sessionManager = new SessionManager(this.runManager);
    this.runner = new TaskRunner(this.runManager, this.sessionManager, engine);
    this.reconciler = new Reconciler(this.runManager);
  }

  async start(): Promise<void> {
    // Reconcile first
    const actions = await this.reconciler.reconcile();
    if (actions.length > 0) {
      console.log(`[daemon] Reconciled ${actions.length} orphaned runs`);
      for (const a of actions) {
        console.log(`[daemon]   ${a.runId}: ${a.action} — ${a.detail}`);
      }
    }

    // Start polling
    this.pollInterval = setInterval(() => this.poll(), this.intervalMs);
    console.log(`[daemon] Watching ${this.runManager.getRunsDir()} (poll every ${this.intervalMs}ms)`);
  }

  async stop(): Promise<void> {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    console.log('[daemon] Stopped');
  }

  private async poll(): Promise<void> {
    try {
      const runs = await this.runManager.listRuns();
      for (const run of runs) {
        if (run.state !== 'created') continue;
        if (this.processing.has(run.run_id)) continue;

        // Check if request.json exists (not yet consumed)
        const requestPath = path.join(this.runManager.getRunDir(run.run_id), 'request.json');
        if (!fs.existsSync(requestPath)) continue;

        this.processing.add(run.run_id);
        console.log(`[daemon] Processing ${run.run_id}`);

        this.runner.processRun(run.run_id)
          .then(() => {
            console.log(`[daemon] Completed ${run.run_id}`);
          })
          .catch((err) => {
            console.error(`[daemon] Error processing ${run.run_id}:`, err);
          })
          .finally(() => {
            this.processing.delete(run.run_id);
          });
      }
    } catch (err) {
      console.error('[daemon] Poll error:', err);
    }
  }
}

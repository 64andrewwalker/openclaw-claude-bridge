import * as fs from 'node:fs';
import type { RunManager } from './run-manager.js';
import type { SessionManager } from './session-manager.js';
import type { Engine } from './engine.js';
import { makeError } from '../schemas/errors.js';

export class TaskRunner {
  constructor(
    private runManager: RunManager,
    private sessionManager: SessionManager,
    private engine: Engine,
  ) {}

  async processRun(runId: string): Promise<void> {
    const startTime = Date.now();
    const request = await this.runManager.consumeRequest(runId);

    if (!request) {
      await this.fail(runId, startTime, makeError('REQUEST_INVALID', 'No request.json found'));
      return;
    }

    // Validate workspace exists and is a directory
    if (!fs.existsSync(request.workspace_path) || !fs.statSync(request.workspace_path).isDirectory()) {
      await this.fail(runId, startTime, makeError('WORKSPACE_NOT_FOUND', `Workspace not found: ${request.workspace_path}`));
      return;
    }

    // Execute via engine
    const engineResponse = await (async () => {
      if (request.mode === 'resume' && request.session_id) {
        await this.sessionManager.transition(runId, 'running', { session_id: request.session_id });
        return this.engine.send(request.session_id, request.message, {
          timeoutMs: request.constraints?.timeout_ms,
          cwd: request.workspace_path,
        });
      } else {
        await this.sessionManager.transition(runId, 'running');
        return this.engine.start(request);
      }
    })();

    // Update session with pid/session_id from engine
    if (engineResponse.pid) {
      await this.runManager.updateSession(runId, {
        pid: engineResponse.pid,
        session_id: engineResponse.sessionId ?? undefined,
      });
    }

    const durationMs = Date.now() - startTime;

    if (engineResponse.error) {
      await this.fail(runId, startTime, engineResponse.error, engineResponse);
      return;
    }

    // Success
    await this.sessionManager.transition(runId, 'completed');
    await this.runManager.writeResult(runId, {
      run_id: runId,
      status: 'completed',
      summary: engineResponse.output.slice(0, 2000),
      session_id: engineResponse.sessionId ?? null,
      artifacts: [],
      duration_ms: durationMs,
      token_usage: engineResponse.tokenUsage ?? null,
    });
  }

  private async fail(
    runId: string,
    startTime: number,
    error: { code: string; message: string; retryable: boolean },
    engineResponse?: { output?: string; sessionId?: string | null; tokenUsage?: unknown },
  ): Promise<void> {
    try {
      const session = await this.sessionManager.getSession(runId);
      if (session.state !== 'failed' && session.state !== 'completed') {
        if (session.state === 'created') {
          await this.sessionManager.transition(runId, 'running');
        }
        await this.sessionManager.transition(runId, 'failed');
      }
    } catch { /* best effort */ }

    await this.runManager.writeResult(runId, {
      run_id: runId,
      status: 'failed',
      summary: error.message,
      session_id: engineResponse?.sessionId ?? null,
      artifacts: [],
      duration_ms: Date.now() - startTime,
      token_usage: null,
      error,
    });
  }
}

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { RunManager } from './run-manager.js';
import type { SessionManager } from './session-manager.js';
import type { Engine } from './engine.js';
import { makeError } from '../schemas/errors.js';
import { validateRequest } from '../schemas/request.js';

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

    // Validate request against schema
    const validation = validateRequest(request);
    if (!validation.success) {
      await this.fail(runId, startTime, makeError('REQUEST_INVALID', validation.error.message));
      return;
    }

    // Security: resolve workspace and check against allowed_roots
    const resolvedWorkspace = path.resolve(request.workspace_path);
    if (request.allowed_roots && request.allowed_roots.length > 0) {
      const resolvedRoots = request.allowed_roots.map(r => path.resolve(r));
      const hasFilesystemRoot = resolvedRoots.some(r => r === path.sep);
      if (hasFilesystemRoot) {
        await this.fail(runId, startTime, makeError('WORKSPACE_INVALID',
          'Filesystem root is not permitted as an allowed_root'));
        return;
      }
      const isAllowed = resolvedRoots.some(resolvedRoot =>
        resolvedWorkspace === resolvedRoot || resolvedWorkspace.startsWith(resolvedRoot + path.sep)
      );
      if (!isAllowed) {
        await this.fail(runId, startTime, makeError('WORKSPACE_INVALID',
          `Workspace ${resolvedWorkspace} is outside allowed roots: ${request.allowed_roots.join(', ')}`));
        return;
      }
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

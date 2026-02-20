import type { RunManager } from './run-manager.js';
import type { Session } from '../schemas/session.js';

const VALID_TRANSITIONS: Record<string, string[]> = {
  created: ['running'],
  running: ['completed', 'failed', 'stopping'],
  stopping: ['completed', 'failed'],
};

export class SessionManager {
  constructor(private runManager: RunManager) {}

  async getSession(runId: string): Promise<Session> {
    return this.runManager.getStatus(runId);
  }

  async transition(
    runId: string,
    newState: Session['state'],
    updates?: Partial<Pick<Session, 'pid' | 'session_id'>>
  ): Promise<Session> {
    const current = await this.getSession(runId);
    const allowed = VALID_TRANSITIONS[current.state] ?? [];
    if (!allowed.includes(newState)) {
      throw new Error(
        `Invalid state transition: ${current.state} \u2192 ${newState} (allowed: ${allowed.join(', ') || 'none'})`
      );
    }
    await this.runManager.updateSession(runId, { state: newState, ...updates });
    return this.getSession(runId);
  }
}

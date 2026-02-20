import * as fs from 'node:fs';
import * as path from 'node:path';
import { nanoid } from 'nanoid';
import type { TaskRequest } from '../schemas/request.js';
import type { Session } from '../schemas/session.js';

export class RunManager {
  constructor(private runsDir: string) {
    fs.mkdirSync(runsDir, { recursive: true });
  }

  async createRun(request: Omit<TaskRequest, 'constraints' | 'session_id' | 'allowed_roots'> & Partial<TaskRequest>): Promise<string> {
    const runId = `run-${nanoid(12)}`;
    const runDir = path.join(this.runsDir, runId);

    fs.mkdirSync(runDir, { recursive: true });
    fs.mkdirSync(path.join(runDir, 'context'), { recursive: true });
    fs.mkdirSync(path.join(runDir, 'logs'), { recursive: true });
    fs.mkdirSync(path.join(runDir, 'artifacts'), { recursive: true });

    // Atomic write: tmp → rename
    const requestTmp = path.join(runDir, 'request.tmp');
    const requestFinal = path.join(runDir, 'request.json');
    fs.writeFileSync(requestTmp, JSON.stringify({ ...request, run_id: runId }, null, 2));
    fs.renameSync(requestTmp, requestFinal);

    // Write session.json
    const now = new Date().toISOString();
    const session: Session = {
      run_id: runId,
      engine: request.engine ?? 'claude-code',
      session_id: request.session_id ?? null,
      state: 'created',
      pid: null,
      created_at: now,
      last_active_at: now,
    };
    fs.writeFileSync(path.join(runDir, 'session.json'), JSON.stringify(session, null, 2));

    return runId;
  }

  async getStatus(runId: string): Promise<Session> {
    const sessionPath = path.join(this.runsDir, runId, 'session.json');
    const raw = fs.readFileSync(sessionPath, 'utf-8');
    return JSON.parse(raw) as Session;
  }

  async listRuns(): Promise<Array<Session & { run_id: string }>> {
    const entries = fs.readdirSync(this.runsDir, { withFileTypes: true });
    const runs: Array<Session & { run_id: string }> = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const sessionPath = path.join(this.runsDir, entry.name, 'session.json');
      if (!fs.existsSync(sessionPath)) continue;
      const raw = fs.readFileSync(sessionPath, 'utf-8');
      runs.push({ ...JSON.parse(raw), run_id: entry.name });
    }
    return runs;
  }

  async consumeRequest(runId: string): Promise<TaskRequest | null> {
    const runDir = path.join(this.runsDir, runId);
    const requestPath = path.join(runDir, 'request.json');
    const processingPath = path.join(runDir, 'request.processing.json');
    if (!fs.existsSync(requestPath)) return null;
    const raw = fs.readFileSync(requestPath, 'utf-8');
    fs.renameSync(requestPath, processingPath);
    return JSON.parse(raw) as TaskRequest;
  }

  async updateSession(runId: string, updates: Partial<Session>): Promise<void> {
    const sessionPath = path.join(this.runsDir, runId, 'session.json');
    const current = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
    const updated = { ...current, ...updates, last_active_at: new Date().toISOString() };
    fs.writeFileSync(sessionPath, JSON.stringify(updated, null, 2));
  }

  async writeResult(runId: string, result: Record<string, unknown>): Promise<void> {
    const resultPath = path.join(this.runsDir, runId, 'result.json');
    fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));
  }

  getRunDir(runId: string): string {
    return path.join(this.runsDir, runId);
  }

  getRunsDir(): string {
    return this.runsDir;
  }
}

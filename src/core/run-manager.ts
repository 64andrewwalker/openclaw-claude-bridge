import * as fs from "node:fs";
import * as path from "node:path";
import { nanoid } from "nanoid";
import type { TaskRequest } from "../schemas/request.js";
import type { Session } from "../schemas/session.js";

export class RunManager {
  constructor(private runsDir: string) {
    fs.mkdirSync(runsDir, { recursive: true });
  }

  async createRun(
    request: Omit<TaskRequest, "constraints" | "session_id" | "allowed_roots"> &
      Partial<TaskRequest>,
  ): Promise<string> {
    const runId = `run-${nanoid(12)}`;
    const runDir = path.join(this.runsDir, runId);

    fs.mkdirSync(runDir, { recursive: true });
    fs.mkdirSync(path.join(runDir, "context"), { recursive: true });
    fs.mkdirSync(path.join(runDir, "logs"), { recursive: true });
    fs.mkdirSync(path.join(runDir, "artifacts"), { recursive: true });

    // Atomic write: tmp → rename
    const requestTmp = path.join(runDir, "request.tmp");
    const requestFinal = path.join(runDir, "request.json");
    fs.writeFileSync(
      requestTmp,
      JSON.stringify({ ...request, run_id: runId }, null, 2),
    );
    fs.renameSync(requestTmp, requestFinal);

    // Write session.json
    const now = new Date().toISOString();
    const session: Session = {
      run_id: runId,
      engine: request.engine ?? "claude-code",
      session_id: request.session_id ?? null,
      state: "created",
      pid: null,
      created_at: now,
      last_active_at: now,
    };
    this.atomicWriteJson(path.join(runDir, "session.json"), session);

    return runId;
  }

  async getStatus(runId: string): Promise<Session> {
    const sessionPath = path.join(this.runsDir, runId, "session.json");
    const raw = fs.readFileSync(sessionPath, "utf-8");
    return JSON.parse(raw) as Session;
  }

  async listRuns(): Promise<Array<Session & { run_id: string }>> {
    const entries = fs.readdirSync(this.runsDir, { withFileTypes: true });
    const runs: Array<Session & { run_id: string }> = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const sessionPath = path.join(this.runsDir, entry.name, "session.json");
      if (!fs.existsSync(sessionPath)) continue;
      const raw = fs.readFileSync(sessionPath, "utf-8");
      runs.push({ ...JSON.parse(raw), run_id: entry.name });
    }
    return runs;
  }

  async consumeRequest(runId: string): Promise<TaskRequest | null> {
    const runDir = path.join(this.runsDir, runId);
    const requestPath = path.join(runDir, "request.json");
    const processingPath = path.join(runDir, "request.processing.json");
    if (!fs.existsSync(requestPath)) return null;
    try {
      fs.renameSync(requestPath, processingPath);
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === "ENOENT") return null;
      throw err;
    }
    const raw = fs.readFileSync(processingPath, "utf-8");
    return JSON.parse(raw) as TaskRequest;
  }

  async updateSession(runId: string, updates: Partial<Session>): Promise<void> {
    const runDir = path.join(this.runsDir, runId);
    const sessionPath = path.join(runDir, "session.json");
    const lockPath = path.join(runDir, ".session.lock");

    await this.withLock(lockPath, async () => {
      const current = JSON.parse(fs.readFileSync(sessionPath, "utf-8"));
      const updated = {
        ...current,
        ...updates,
        last_active_at: new Date().toISOString(),
      };
      this.atomicWriteJson(sessionPath, updated);
    });
  }

  async writeResult(
    runId: string,
    result: Record<string, unknown>,
  ): Promise<void> {
    const runDir = path.join(this.runsDir, runId);
    const resultPath = path.join(runDir, "result.json");
    const lockPath = path.join(runDir, ".result.lock");
    await this.withLock(lockPath, async () => {
      this.atomicWriteJson(resultPath, result);
    });
  }

  writeOutputFile(runId: string, content: string): void {
    const runDir = path.join(this.runsDir, runId);
    const outputPath = path.join(runDir, "output.txt");
    fs.writeFileSync(outputPath, content);
  }

  getRunDir(runId: string): string {
    const resolved = path.resolve(this.runsDir, runId);
    if (
      !resolved.startsWith(this.runsDir + path.sep) &&
      resolved !== this.runsDir
    ) {
      throw new Error(`Run ID escapes runs directory: ${runId}`);
    }
    return resolved;
  }

  getRunsDir(): string {
    return this.runsDir;
  }

  private atomicWriteJson(filePath: string, data: unknown): void {
    const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
    fs.renameSync(tmpPath, filePath);
  }

  private async withLock(
    lockPath: string,
    fn: () => Promise<void>,
  ): Promise<void> {
    const timeoutMs = 5000;
    const retryMs = 10;
    const start = Date.now();

    while (true) {
      try {
        const fd = fs.openSync(lockPath, "wx");
        fs.closeSync(fd);
        break;
      } catch (err) {
        const e = err as NodeJS.ErrnoException;
        if (e.code !== "EEXIST") throw err;
        if (Date.now() - start > timeoutMs) {
          throw new Error(`Timed out acquiring lock: ${lockPath}`);
        }
        await new Promise((resolve) => setTimeout(resolve, retryMs));
      }
    }

    try {
      await fn();
    } finally {
      try {
        fs.unlinkSync(lockPath);
      } catch {
        /* best effort */
      }
    }
  }
}

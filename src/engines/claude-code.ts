import { spawn } from 'node:child_process';
import type { Engine, EngineResponse } from '../core/engine.js';
import type { TaskRequest } from '../schemas/request.js';
import { makeError } from '../schemas/errors.js';

export interface ClaudeCodeOptions {
  command?: string;
  defaultArgs?: string[];
}

export class ClaudeCodeEngine implements Engine {
  private command: string;
  private defaultArgs: string[];

  constructor(opts?: ClaudeCodeOptions) {
    this.command = opts?.command ?? 'claude';
    this.defaultArgs = opts?.defaultArgs ?? [];
  }

  async start(task: TaskRequest): Promise<EngineResponse> {
    const args = this.buildStartArgs(task);
    return this.exec(args, task.constraints?.timeout_ms ?? 1800000, task.workspace_path);
  }

  async send(sessionId: string, message: string, opts?: { timeoutMs?: number; cwd?: string }): Promise<EngineResponse> {
    const args = ['--resume', sessionId, '--print', '-p', message];
    return this.exec(args, opts?.timeoutMs ?? 1800000, opts?.cwd);
  }

  async stop(pid: number): Promise<void> {
    try { process.kill(pid, 'SIGTERM'); } catch { /* already dead */ }
  }

  private buildStartArgs(task: TaskRequest): string[] {
    if (this.defaultArgs.length > 0) return [...this.defaultArgs];
    return ['--print', '-p', task.message];
  }

  private exec(args: string[], timeoutMs: number, cwd?: string): Promise<EngineResponse> {
    return new Promise((resolve) => {
      const child = spawn(this.command, args, {
        cwd: cwd || process.cwd(),
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 3000);
      }, timeoutMs);

      child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (timedOut) {
          resolve({ output: stdout, pid: child.pid ?? 0, exitCode: code, sessionId: null, error: makeError('ENGINE_TIMEOUT', `Process killed after ${timeoutMs}ms`) });
          return;
        }
        if (code !== 0) {
          resolve({ output: stdout, pid: child.pid ?? 0, exitCode: code, sessionId: null, error: makeError('ENGINE_CRASH', stderr || `Process exited with code ${code}`) });
          return;
        }
        resolve({ output: stdout.trim(), pid: child.pid ?? 0, exitCode: 0, sessionId: this.extractSessionId(stderr + stdout), tokenUsage: this.extractTokenUsage(stderr + stdout) });
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({ output: '', pid: child.pid ?? 0, exitCode: null, sessionId: null, error: makeError('ENGINE_CRASH', err.message) });
      });
    });
  }

  private extractSessionId(output: string): string | null {
    const match = output.match(/"session_id"\s*:\s*"([^"]+)"/);
    return match?.[1] ?? null;
  }

  private extractTokenUsage(_output: string): { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null {
    return null;
  }
}

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
    const args = ['--resume', sessionId, ...this.permissionArgs(), '--print', '--output-format', 'json', '-p', message];
    return this.exec(args, opts?.timeoutMs ?? 1800000, opts?.cwd);
  }

  async stop(pid: number): Promise<void> {
    try { process.kill(pid, 'SIGTERM'); } catch { /* already dead */ }
  }

  private buildStartArgs(task: TaskRequest): string[] {
    if (this.defaultArgs.length > 0) return [...this.defaultArgs];
    return [...this.permissionArgs(), '--print', '--output-format', 'json', '-p', task.message];
  }

  private permissionArgs(): string[] {
    const permissionMode = process.env.CODEBRIDGE_CLAUDE_PERMISSION_MODE?.trim();
    if (!permissionMode) return [];
    return ['--permission-mode', permissionMode];
  }

  private exec(args: string[], timeoutMs: number, cwd?: string): Promise<EngineResponse> {
    return new Promise((resolve) => {
      const child = spawn(this.command, args, {
        cwd: cwd || process.cwd(),
        // Keep stdout/stderr piped for parsing, but close stdin so Claude CLI
        // does not wait for additional input in non-interactive execution.
        stdio: ['ignore', 'pipe', 'pipe'],
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
        const parsed = this.parseClaudeJson(stdout);
        if (timedOut) {
          resolve({ output: stdout, pid: child.pid ?? 0, exitCode: code, sessionId: null, error: makeError('ENGINE_TIMEOUT', `Process killed after ${timeoutMs}ms`) });
          return;
        }
        if (code !== 0) {
          resolve({ output: stdout, pid: child.pid ?? 0, exitCode: code, sessionId: null, error: makeError('ENGINE_CRASH', stderr || `Process exited with code ${code}`) });
          return;
        }
        resolve({
          output: typeof parsed?.result === 'string' ? parsed.result : stdout.trim(),
          pid: child.pid ?? 0,
          exitCode: 0,
          sessionId: this.extractSessionId(parsed, stderr + stdout),
          tokenUsage: this.extractTokenUsage(parsed),
        });
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({ output: '', pid: child.pid ?? 0, exitCode: null, sessionId: null, error: makeError('ENGINE_CRASH', err.message) });
      });
    });
  }

  private parseClaudeJson(output: string): Record<string, unknown> | null {
    const trimmed = output.trim();
    if (!trimmed) return null;

    try {
      return JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      // Some environments may prepend warnings/logs. Try the last JSON line.
      const lines = trimmed.split('\n').map((l) => l.trim()).filter(Boolean).reverse();
      for (const line of lines) {
        if (!line.startsWith('{')) continue;
        try {
          return JSON.parse(line) as Record<string, unknown>;
        } catch {
          // Keep trying.
        }
      }
      return null;
    }
  }

  private extractSessionId(parsed: Record<string, unknown> | null, rawOutput: string): string | null {
    if (typeof parsed?.session_id === 'string') return parsed.session_id;
    const match = rawOutput.match(/"session_id"\s*:\s*"([^"]+)"/);
    return match?.[1] ?? null;
  }

  private extractTokenUsage(parsed: Record<string, unknown> | null): { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null {
    const usage = parsed?.usage as Record<string, unknown> | undefined;
    const input = usage?.input_tokens;
    const output = usage?.output_tokens;
    if (typeof input !== 'number' || typeof output !== 'number') return null;
    return {
      prompt_tokens: input,
      completion_tokens: output,
      total_tokens: input + output,
    };
  }
}

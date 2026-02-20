import { spawn } from 'node:child_process';
import path from 'node:path';
import type { Engine, EngineResponse } from '../core/engine.js';
import type { TaskRequest } from '../schemas/request.js';
import { makeError } from '../schemas/errors.js';

export interface ClaudeCodeOptions {
  command?: string;
  defaultArgs?: string[];
}

export class ClaudeCodeEngine implements Engine {
  private static readonly MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
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
    const validModes = new Set(['acceptEdits', 'bypassPermissions', 'default', 'dontAsk', 'plan']);
    if (!validModes.has(permissionMode)) return [];
    return ['--permission-mode', permissionMode];
  }

  private exec(args: string[], timeoutMs: number, cwd?: string): Promise<EngineResponse> {
    return new Promise((resolve) => {
      const extraBins = [
        '/opt/homebrew/bin',
        '/usr/local/bin',
        '/usr/bin',
      ];
      const home = process.env.HOME;
      if (home) {
        extraBins.push(path.join(home, '.local', 'bin'));
        extraBins.push(path.join(home, '.npm-global', 'bin'));
      }
      const mergedPath = [...new Set([...(process.env.PATH ?? '').split(':').filter(Boolean), ...extraBins])].join(':');

      const child = spawn(this.command, args, {
        cwd: cwd || process.cwd(),
        env: { ...process.env, PATH: mergedPath },
        // Keep stdout/stderr piped for parsing, but close stdin so Claude CLI
        // does not wait for additional input in non-interactive execution.
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let outputOverflow = false;
      let totalBytes = 0;

      const captureChunk = (chunk: Buffer, target: 'stdout' | 'stderr') => {
        if (outputOverflow) return;
        const incoming = chunk.toString();
        const incomingBytes = Buffer.byteLength(incoming);
        const remaining = ClaudeCodeEngine.MAX_OUTPUT_BYTES - totalBytes;

        if (incomingBytes > remaining) {
          if (remaining > 0) {
            const partial = chunk.subarray(0, remaining).toString();
            if (target === 'stdout') stdout += partial;
            else stderr += partial;
            totalBytes += remaining;
          }
          outputOverflow = true;
          child.kill('SIGTERM');
          setTimeout(() => child.kill('SIGKILL'), 1000);
          return;
        }

        if (target === 'stdout') stdout += incoming;
        else stderr += incoming;
        totalBytes += incomingBytes;
      };

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 3000);
      }, timeoutMs);

      child.stdout?.on('data', (chunk: Buffer) => captureChunk(chunk, 'stdout'));
      child.stderr?.on('data', (chunk: Buffer) => captureChunk(chunk, 'stderr'));

      child.on('close', (code) => {
        clearTimeout(timer);
        const parsed = this.parseClaudeJson(stdout);
        if (timedOut) {
          resolve({ output: stdout, pid: child.pid ?? 0, exitCode: code, sessionId: null, error: makeError('ENGINE_TIMEOUT', `Process killed after ${timeoutMs}ms`) });
          return;
        }
        if (outputOverflow) {
          resolve({
            output: stdout,
            pid: child.pid ?? 0,
            exitCode: code,
            sessionId: null,
            error: makeError('ENGINE_CRASH', `Engine output exceeded ${ClaudeCodeEngine.MAX_OUTPUT_BYTES} bytes`),
          });
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
        if (!line.startsWith('{') && !line.startsWith('[')) continue;
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

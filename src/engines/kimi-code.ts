import { spawn } from 'node:child_process';
import path from 'node:path';
import type { Engine, EngineResponse } from '../core/engine.js';
import type { TaskRequest } from '../schemas/request.js';
import { makeError } from '../schemas/errors.js';

export interface KimiCodeOptions {
  command?: string;
  defaultArgs?: string[];
}

export class KimiCodeEngine implements Engine {
  private static readonly MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
  private command: string;
  private defaultArgs: string[];

  constructor(opts?: KimiCodeOptions) {
    this.command = opts?.command ?? 'kimi';
    this.defaultArgs = opts?.defaultArgs ?? [];
  }

  async start(task: TaskRequest): Promise<EngineResponse> {
    const args = this.buildStartArgs(task);
    return this.exec(args, task.constraints?.timeout_ms ?? 1800000, task.workspace_path);
  }

  async send(sessionId: string, message: string, opts?: { timeoutMs?: number; cwd?: string }): Promise<EngineResponse> {
    const args = [
      '--print', '--output-format', 'stream-json',
      '--session', sessionId,
      '-w', opts?.cwd ?? process.cwd(),
      '-p', message,
    ];
    return this.exec(args, opts?.timeoutMs ?? 1800000, opts?.cwd);
  }

  async stop(pid: number): Promise<void> {
    try { process.kill(pid, 'SIGTERM'); } catch { /* already dead */ }
  }

  private buildStartArgs(task: TaskRequest): string[] {
    if (this.defaultArgs.length > 0) return [...this.defaultArgs];
    return [
      '--print', '--output-format', 'stream-json',
      '-w', task.workspace_path,
      '-p', task.message,
    ];
  }

  private exec(args: string[], timeoutMs: number, cwd?: string): Promise<EngineResponse> {
    return new Promise((resolve) => {
      const extraBins = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'];
      const home = process.env.HOME;
      if (home) {
        extraBins.push(path.join(home, '.local', 'bin'));
        extraBins.push(path.join(home, '.npm-global', 'bin'));
      }
      const mergedPath = [...new Set([...(process.env.PATH ?? '').split(':').filter(Boolean), ...extraBins])].join(':');

      const child = spawn(this.command, args, {
        cwd: cwd || process.cwd(),
        env: { ...process.env, PATH: mergedPath },
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
        const remaining = KimiCodeEngine.MAX_OUTPUT_BYTES - totalBytes;

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
            error: makeError('ENGINE_CRASH', `Engine output exceeded ${KimiCodeEngine.MAX_OUTPUT_BYTES} bytes`),
          });
          return;
        }
        if (code !== 0) {
          resolve({ output: stdout, pid: child.pid ?? 0, exitCode: code, sessionId: null, error: makeError('ENGINE_CRASH', stderr || `Process exited with code ${code}`) });
          return;
        }
        const parsed = this.parseKimiJson(stdout);
        resolve({
          output: parsed.text,
          pid: child.pid ?? 0,
          exitCode: 0,
          sessionId: null,
          tokenUsage: null,
        });
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({ output: '', pid: child.pid ?? 0, exitCode: null, sessionId: null, error: makeError('ENGINE_CRASH', err.message) });
      });
    });
  }

  private parseKimiJson(output: string): { text: string } {
    const trimmed = output.trim();
    if (!trimmed) return { text: '' };

    try {
      const parsed = JSON.parse(trimmed) as { role?: string; content?: Array<{ type: string; text?: string }> };
      if (parsed.content && Array.isArray(parsed.content)) {
        const textParts = parsed.content
          .filter((c) => c.type === 'text' && typeof c.text === 'string')
          .map((c) => c.text as string);
        return { text: textParts.join('') };
      }
    } catch {
      const lines = trimmed.split('\n').map((l) => l.trim()).filter(Boolean).reverse();
      for (const line of lines) {
        if (!line.startsWith('{') && !line.startsWith('[')) continue;
        try {
          const parsed = JSON.parse(line) as { content?: Array<{ type: string; text?: string }> };
          if (parsed.content && Array.isArray(parsed.content)) {
            const textParts = parsed.content
              .filter((c) => c.type === 'text' && typeof c.text === 'string')
              .map((c) => c.text as string);
            return { text: textParts.join('') };
          }
        } catch { /* keep trying */ }
      }
    }

    return { text: trimmed };
  }
}

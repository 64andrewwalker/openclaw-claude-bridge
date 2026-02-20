import { spawn } from 'node:child_process';
import path from 'node:path';
import type { EngineResponse } from '../core/engine.js';
import { makeError } from '../schemas/errors.js';

export abstract class BaseEngine {
  static readonly MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

  protected exec(command: string, args: string[], timeoutMs: number, cwd?: string): Promise<EngineResponse> {
    return new Promise((resolve) => {
      const extraBins = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'];
      const home = process.env.HOME;
      if (home) {
        extraBins.push(path.join(home, '.local', 'bin'));
        extraBins.push(path.join(home, '.npm-global', 'bin'));
      }
      const mergedPath = [...new Set([...(process.env.PATH ?? '').split(':').filter(Boolean), ...extraBins])].join(':');

      const child = spawn(command, args, {
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
        const remaining = BaseEngine.MAX_OUTPUT_BYTES - totalBytes;

        if (incomingBytes > remaining) {
          if (remaining > 0) {
            const partial = chunk.subarray(0, remaining).toString();
            if (target === 'stdout') stdout += partial;
            else stderr += partial;
            totalBytes += remaining;
          }
          outputOverflow = true;
          child.kill('SIGTERM');
          setTimeout(() => child.kill('SIGKILL'), 3000);
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
            error: makeError('ENGINE_CRASH', `Engine output exceeded ${BaseEngine.MAX_OUTPUT_BYTES} bytes`),
          });
          return;
        }
        if (code !== 0) {
          resolve({ output: stdout, pid: child.pid ?? 0, exitCode: code, sessionId: null, error: makeError('ENGINE_CRASH', stderr || `Process exited with code ${code}`) });
          return;
        }
        resolve(this.parseOutput(stdout, stderr, child.pid ?? 0));
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({ output: '', pid: child.pid ?? 0, exitCode: null, sessionId: null, error: makeError('ENGINE_CRASH', err.message) });
      });
    });
  }

  protected abstract parseOutput(stdout: string, stderr: string, pid: number): EngineResponse;
}

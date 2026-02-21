import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Engine, EngineResponse } from '../core/engine.js';
import type { TaskRequest } from '../schemas/request.js';
import { BaseEngine } from './base-engine.js';

export interface KimiCodeOptions {
  command?: string;
  defaultArgs?: string[];
}

export class KimiCodeEngine extends BaseEngine implements Engine {
  private command: string;
  private defaultArgs: string[];

  constructor(opts?: KimiCodeOptions) {
    super();
    this.command = opts?.command ?? 'kimi';
    this.defaultArgs = opts?.defaultArgs ?? [];
  }

  async start(task: TaskRequest): Promise<EngineResponse> {
    const args = this.buildStartArgs(task);
    const result = await this.exec(this.command, args, task.constraints?.timeout_ms ?? 1800000, task.workspace_path);
    if (!result.error) {
      result.sessionId = this.readKimiSessionId(task.workspace_path);
    }
    return result;
  }

  async send(sessionId: string, message: string, opts?: { timeoutMs?: number; cwd?: string }): Promise<EngineResponse> {
    const cwd = opts?.cwd ?? process.cwd();
    const args = [
      '--print', '--output-format', 'stream-json',
      '--session', sessionId,
      '-w', cwd,
      '-p', message,
    ];
    const result = await this.exec(this.command, args, opts?.timeoutMs ?? 1800000, opts?.cwd);
    if (!result.error) {
      result.sessionId = this.readKimiSessionId(cwd);
    }
    return result;
  }

  async stop(pid: number): Promise<void> {
    try { process.kill(pid, 'SIGTERM'); } catch { /* already dead */ }
  }

  private buildStartArgs(task: TaskRequest): string[] {
    if (this.defaultArgs.length > 0) return [...this.defaultArgs];
    const args = ['--print', '--output-format', 'stream-json', '-w', task.workspace_path];
    if (task.model) {
      args.push('-m', task.model);
    }
    args.push('-p', task.message);
    return args;
  }

  protected parseOutput(stdout: string, _stderr: string, pid: number): EngineResponse {
    const parsed = this.parseKimiJson(stdout);
    return {
      output: parsed.text,
      pid,
      exitCode: 0,
      sessionId: null,
      tokenUsage: null,
    };
  }

  private readKimiSessionId(workspace: string): string | null {
    try {
      const configPath = path.join(os.homedir(), '.kimi', 'kimi.json');
      const data = JSON.parse(readFileSync(configPath, 'utf-8')) as {
        work_dirs?: Array<{ path: string; last_session_id?: string }>;
      };
      if (!data.work_dirs || !Array.isArray(data.work_dirs)) return null;
      const entry = data.work_dirs.find((d) => d.path === workspace);
      return entry?.last_session_id || null;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        process.stderr.write(`[kimi-code] Failed to read session config: ${(err as Error).message}\n`);
      }
      return null;
    }
  }

  private parseKimiJson(output: string): { text: string } {
    const trimmed = output.trim();
    if (!trimmed) return { text: '' };

    // Kimi's stream-json outputs NDJSON (one JSON per line).
    // Collect text parts from ALL lines that contain content arrays.
    const lines = trimmed.split('\n').map((l) => l.trim()).filter(Boolean);
    const parts: string[] = [];
    let foundContentArray = false;
    for (const line of lines) {
      if (!line.startsWith('{') && !line.startsWith('[')) continue;
      try {
        const parsed = JSON.parse(line) as { content?: Array<{ type: string; text?: string }> };
        if (parsed.content && Array.isArray(parsed.content)) {
          foundContentArray = true;
          for (const c of parsed.content) {
            if (c.type === 'text' && typeof c.text === 'string') parts.push(c.text);
          }
        }
      } catch { /* skip unparseable lines */ }
    }

    // If we found content arrays, return collected text (may be empty if only think/tool parts).
    // Only fall back to raw output when no Kimi JSON structure was found at all.
    if (foundContentArray) return { text: parts.join('') };
    return { text: trimmed };
  }
}

import type { Engine, EngineResponse } from '../core/engine.js';
import type { TaskRequest } from '../schemas/request.js';
import { BaseEngine } from './base-engine.js';

export interface OpenCodeOptions {
  command?: string;
  defaultArgs?: string[];
}

export class OpenCodeEngine extends BaseEngine implements Engine {
  private command: string;
  private defaultArgs: string[];

  constructor(opts?: OpenCodeOptions) {
    super();
    this.command = opts?.command ?? 'opencode';
    this.defaultArgs = opts?.defaultArgs ?? [];
  }

  async start(task: TaskRequest): Promise<EngineResponse> {
    const args = this.buildStartArgs(task);
    return this.exec(this.command, args, task.constraints?.timeout_ms ?? 1800000, task.workspace_path);
  }

  async send(sessionId: string, message: string, opts?: { timeoutMs?: number; cwd?: string }): Promise<EngineResponse> {
    const args = [
      'run', '--format', 'json',
      '--dir', opts?.cwd ?? process.cwd(),
      '-s', sessionId,
      message,
    ];
    return this.exec(this.command, args, opts?.timeoutMs ?? 1800000, opts?.cwd);
  }

  async stop(pid: number): Promise<void> {
    try { process.kill(pid, 'SIGTERM'); } catch { /* already dead */ }
  }

  private buildStartArgs(task: TaskRequest): string[] {
    if (this.defaultArgs.length > 0) return [...this.defaultArgs];
    const args = ['run', '--format', 'json', '--dir', task.workspace_path];
    if (task.model) {
      args.push('-m', task.model);
    }
    args.push(task.message);
    return args;
  }

  protected parseOutput(stdout: string, _stderr: string, pid: number): EngineResponse {
    const parsed = this.parseOpenCodeNdjson(stdout);
    return {
      output: parsed.text,
      pid,
      exitCode: 0,
      sessionId: parsed.sessionId,
      tokenUsage: parsed.tokenUsage,
    };
  }

  private parseOpenCodeNdjson(output: string): {
    text: string;
    sessionId: string | null;
    tokenUsage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null;
  } {
    const trimmed = output.trim();
    if (!trimmed) return { text: '', sessionId: null, tokenUsage: null };

    const lines = trimmed.split('\n').map(l => l.trim()).filter(Boolean);
    const textParts: string[] = [];
    let sessionId: string | null = null;
    let tokenUsage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null = null;

    for (const line of lines) {
      if (!line.startsWith('{')) continue;
      try {
        const event = JSON.parse(line) as Record<string, unknown>;

        // Extract sessionID from any event
        if (typeof event.sessionID === 'string' && !sessionId) {
          sessionId = event.sessionID;
        }

        // Collect text from "text" type events
        if (event.type === 'text') {
          const part = event.part as Record<string, unknown> | undefined;
          if (part && typeof part.text === 'string') {
            textParts.push(part.text);
          }
        }

        // Extract token usage from step_finish events
        if (event.type === 'step_finish') {
          const part = event.part as Record<string, unknown> | undefined;
          if (part && typeof part.tokens === 'object' && part.tokens !== null) {
            const tokens = part.tokens as Record<string, unknown>;
            const input = typeof tokens.input === 'number' ? tokens.input : 0;
            const output = typeof tokens.output === 'number' ? tokens.output : 0;
            const total = typeof tokens.total === 'number' ? tokens.total : input + output;
            tokenUsage = { prompt_tokens: input, completion_tokens: output, total_tokens: total };
          }
        }
      } catch { /* skip unparseable lines */ }
    }

    if (textParts.length > 0 || sessionId || tokenUsage) {
      return { text: textParts.join(''), sessionId, tokenUsage };
    }

    // Fallback to raw output if no NDJSON structure found
    return { text: trimmed, sessionId: null, tokenUsage: null };
  }
}

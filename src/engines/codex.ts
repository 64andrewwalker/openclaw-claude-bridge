import type { Engine, EngineResponse } from '../core/engine.js';
import type { TaskRequest } from '../schemas/request.js';
import { BaseEngine } from './base-engine.js';

export interface CodexOptions {
  command?: string;
  defaultArgs?: string[];
}

export class CodexEngine extends BaseEngine implements Engine {
  private command: string;
  private defaultArgs: string[];

  constructor(opts?: CodexOptions) {
    super();
    this.command = opts?.command ?? 'codex';
    this.defaultArgs = opts?.defaultArgs ?? [];
  }

  async start(task: TaskRequest): Promise<EngineResponse> {
    const args = this.buildStartArgs(task);
    return this.exec(this.command, args, task.constraints?.timeout_ms ?? 1800000, task.workspace_path);
  }

  async send(sessionId: string, message: string, opts?: { timeoutMs?: number; cwd?: string }): Promise<EngineResponse> {
    const args = [
      'exec', '--json', '--full-auto',
      '-C', opts?.cwd ?? process.cwd(),
      'resume', sessionId, message,
    ];
    return this.exec(this.command, args, opts?.timeoutMs ?? 1800000, opts?.cwd);
  }

  async stop(pid: number): Promise<void> {
    try { process.kill(pid, 'SIGTERM'); } catch { /* already dead */ }
  }

  private buildStartArgs(task: TaskRequest): string[] {
    if (this.defaultArgs.length > 0) return [...this.defaultArgs];
    const args = ['exec', '--json', '--full-auto', '-C', task.workspace_path];
    if (task.model) {
      args.push('-m', task.model);
    }
    args.push(task.message);
    return args;
  }

  protected parseOutput(stdout: string, _stderr: string, pid: number): EngineResponse {
    const parsed = this.parseCodexJsonl(stdout);
    return {
      output: parsed.text,
      pid,
      exitCode: 0,
      sessionId: parsed.sessionId,
      tokenUsage: null, // Codex CLI doesn't reliably expose token usage
    };
  }

  private parseCodexJsonl(output: string): { text: string; sessionId: string | null } {
    const trimmed = output.trim();
    if (!trimmed) return { text: '', sessionId: null };

    const lines = trimmed.split('\n').map(l => l.trim()).filter(Boolean);
    const textParts: string[] = [];
    let sessionId: string | null = null;

    for (const line of lines) {
      if (!line.startsWith('{')) continue;
      try {
        const event = JSON.parse(line) as Record<string, unknown>;

        // Extract session/thread ID from thread.started event
        // v0.104.0 uses thread_id at top level
        if (event.type === 'thread.started') {
          if (typeof event.thread_id === 'string') {
            sessionId = event.thread_id;
          }
          // Also support thread.id for forward compatibility
          const thread = event.thread as Record<string, unknown> | undefined;
          if (!sessionId && thread && typeof thread.id === 'string') {
            sessionId = thread.id;
          }
        }

        // Extract text from item.completed events
        // v0.104.0: item.type === 'agent_message', text in item.text
        if (event.type === 'item.completed') {
          const item = event.item as Record<string, unknown> | undefined;
          if (item) {
            // Primary: agent_message with item.text (v0.104.0 format)
            if (item.type === 'agent_message' && typeof item.text === 'string') {
              textParts.push(item.text);
            }
            // Fallback: message type with content array
            if (item.type === 'message') {
              const content = item.content as Array<Record<string, unknown>> | undefined;
              if (Array.isArray(content)) {
                for (const part of content) {
                  if ((part.type === 'output_text' || part.type === 'text') && typeof part.text === 'string') {
                    textParts.push(part.text);
                  }
                }
              }
            }
          }
        }

        // Extract text from message/response completed events (fallback)
        if (event.type === 'message.completed' || event.type === 'response.completed') {
          const message = (event.message ?? event.response) as Record<string, unknown> | undefined;
          if (message) {
            const content = message.content as Array<Record<string, unknown>> | undefined;
            if (Array.isArray(content)) {
              for (const part of content) {
                if (part.type === 'text' && typeof part.text === 'string') {
                  textParts.push(part.text);
                }
              }
            }
            if (typeof message.output_text === 'string') {
              textParts.push(message.output_text);
            }
          }
        }
      } catch { /* skip unparseable lines */ }
    }

    if (textParts.length > 0 || sessionId) {
      return { text: textParts.join(''), sessionId };
    }

    // Fallback to raw output if no JSONL structure found
    return { text: trimmed, sessionId: null };
  }
}

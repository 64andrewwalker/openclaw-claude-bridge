import type { Engine, EngineResponse } from "../core/engine.js";
import type { TaskRequest } from "../schemas/request.js";
import { BaseEngine } from "./base-engine.js";

export interface ClaudeCodeOptions {
  command?: string;
  defaultArgs?: string[];
}

export class ClaudeCodeEngine extends BaseEngine implements Engine {
  private command: string;
  private defaultArgs: string[];

  constructor(opts?: ClaudeCodeOptions) {
    super();
    this.command = opts?.command ?? "claude";
    this.defaultArgs = opts?.defaultArgs ?? [];
  }

  async start(task: TaskRequest): Promise<EngineResponse> {
    const args = this.buildStartArgs(task);
    return this.exec(
      this.command,
      args,
      task.constraints?.timeout_ms ?? 1800000,
      task.workspace_path,
    );
  }

  async send(
    sessionId: string,
    message: string,
    opts?: { timeoutMs?: number; cwd?: string },
  ): Promise<EngineResponse> {
    const args = [
      "--resume",
      sessionId,
      ...this.permissionArgs(),
      "--print",
      "--output-format",
      "json",
      "-p",
      message,
    ];
    return this.exec(this.command, args, opts?.timeoutMs ?? 1800000, opts?.cwd);
  }

  async stop(pid: number): Promise<void> {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      /* already dead */
    }
  }

  private buildStartArgs(task: TaskRequest): string[] {
    if (this.defaultArgs.length > 0) return [...this.defaultArgs];
    const args = [
      ...this.permissionArgs(),
      "--print",
      "--output-format",
      "json",
    ];
    if (task.model) {
      args.push("--model", task.model);
    }
    args.push("-p", task.message);
    return args;
  }

  private permissionArgs(): string[] {
    const permissionMode =
      process.env.CODEBRIDGE_CLAUDE_PERMISSION_MODE?.trim();
    if (!permissionMode) return [];
    const validModes = new Set([
      "acceptEdits",
      "bypassPermissions",
      "default",
      "dontAsk",
      "plan",
    ]);
    if (!validModes.has(permissionMode)) return [];
    return ["--permission-mode", permissionMode];
  }

  protected parseOutput(
    stdout: string,
    stderr: string,
    pid: number,
  ): EngineResponse {
    const parsed = this.parseClaudeJson(stdout);
    return {
      output:
        typeof parsed?.result === "string" ? parsed.result : stdout.trim(),
      pid,
      exitCode: 0,
      sessionId: this.extractSessionId(parsed, stderr + stdout),
      tokenUsage: this.extractTokenUsage(parsed),
    };
  }

  private parseClaudeJson(output: string): Record<string, unknown> | null {
    const trimmed = output.trim();
    if (!trimmed) return null;

    try {
      return JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      const lines = trimmed
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .reverse();
      for (const line of lines) {
        if (!line.startsWith("{") && !line.startsWith("[")) continue;
        try {
          return JSON.parse(line) as Record<string, unknown>;
        } catch {
          // Keep trying.
        }
      }
      return null;
    }
  }

  private extractSessionId(
    parsed: Record<string, unknown> | null,
    rawOutput: string,
  ): string | null {
    if (typeof parsed?.session_id === "string") return parsed.session_id;
    const match = rawOutput.match(/"session_id"\s*:\s*"([^"]+)"/);
    return match?.[1] ?? null;
  }

  private extractTokenUsage(
    parsed: Record<string, unknown> | null,
  ): {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  } | null {
    const usage = parsed?.usage as Record<string, unknown> | undefined;
    const input = usage?.input_tokens;
    const output = usage?.output_tokens;
    if (
      typeof input !== "number" ||
      typeof output !== "number" ||
      input < 0 ||
      output < 0
    )
      return null;
    return {
      prompt_tokens: input,
      completion_tokens: output,
      total_tokens: input + output,
    };
  }
}

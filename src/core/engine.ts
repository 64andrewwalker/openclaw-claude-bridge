import type { TaskRequest } from '../schemas/request.js';

export interface EngineError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface EngineResponse {
  output: string;
  pid: number;
  exitCode: number | null;
  sessionId: string | null;
  error?: EngineError;
  tokenUsage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null;
}

export interface Engine {
  start(task: TaskRequest): Promise<EngineResponse>;
  send(sessionId: string, message: string, opts?: { timeoutMs?: number; cwd?: string }): Promise<EngineResponse>;
  stop(pid: number): Promise<void>;
}

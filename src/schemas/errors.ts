export const ERROR_CODES = {
  ENGINE_TIMEOUT: { retryable: true, message: 'Engine execution timed out' },
  ENGINE_CRASH: { retryable: true, message: 'Engine process crashed' },
  ENGINE_AUTH: { retryable: false, message: 'Engine authentication failed' },
  NETWORK_ERROR: { retryable: true, message: 'Network connection failed' },
  WORKSPACE_INVALID: { retryable: false, message: 'Workspace path invalid or out of bounds' },
  WORKSPACE_NOT_FOUND: { retryable: false, message: 'Workspace directory not found' },
  REQUEST_INVALID: { retryable: false, message: 'Invalid request format' },
  RUNNER_CRASH_RECOVERY: { retryable: true, message: 'Orphaned task from runner crash' },
  TASK_STOPPED: { retryable: false, message: 'Task force-stopped by user' },
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export function makeError(code: ErrorCode, detail?: string) {
  const info = ERROR_CODES[code];
  return { code, message: detail ?? info.message, retryable: info.retryable };
}

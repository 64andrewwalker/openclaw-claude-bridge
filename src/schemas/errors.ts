export const ERROR_CODES = {
  ENGINE_TIMEOUT: { category: 'engine', retryable: true, message: 'Engine execution timed out' },
  ENGINE_CRASH: { category: 'engine', retryable: true, message: 'Engine process crashed' },
  ENGINE_AUTH: { category: 'engine', retryable: false, message: 'Engine authentication failed' },
  NETWORK_ERROR: { category: 'network', retryable: true, message: 'Network connection failed' },
  WORKSPACE_INVALID: { category: 'input', retryable: false, message: 'Workspace path invalid or out of bounds' },
  WORKSPACE_NOT_FOUND: { category: 'input', retryable: false, message: 'Workspace directory not found' },
  REQUEST_INVALID: { category: 'input', retryable: false, message: 'Invalid request format' },
  RUNNER_CRASH_RECOVERY: { category: 'internal', retryable: true, message: 'Orphaned task from runner crash' },
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export function makeError(code: ErrorCode, detail?: string) {
  const info = ERROR_CODES[code];
  return { code, message: detail ?? info.message, retryable: info.retryable };
}

export const ERROR_CODES = {
  ENGINE_TIMEOUT: {
    retryable: true,
    message: "Engine execution timed out",
    suggestion: "Increase --timeout or break the task into smaller steps",
  },
  ENGINE_CRASH: {
    retryable: true,
    message: "Engine process crashed",
    suggestion: "Engine process crashed unexpectedly, retry the task",
  },
  ENGINE_AUTH: {
    retryable: false,
    message: "Engine authentication failed",
    suggestion: "Check engine authentication credentials",
  },
  NETWORK_ERROR: {
    retryable: true,
    message: "Network connection failed",
    suggestion: "Check network connectivity and retry",
  },
  WORKSPACE_INVALID: {
    retryable: false,
    message: "Workspace path invalid or out of bounds",
    suggestion: "Workspace is outside allowed_roots, use a permitted directory",
  },
  WORKSPACE_NOT_FOUND: {
    retryable: false,
    message: "Workspace directory not found",
    suggestion: "Verify the workspace path exists",
  },
  REQUEST_INVALID: {
    retryable: false,
    message: "Invalid request format",
    suggestion: "Check intent, engine, and workspace fields",
  },
  RUNNER_CRASH_RECOVERY: {
    retryable: true,
    message: "Orphaned task from runner crash",
    suggestion: "Daemon recovered from crash, retry the task",
  },
  OUTPUT_WRITE_FAILED: {
    retryable: true,
    message: "Failed to write output file",
    suggestion: "Check disk space and permissions in the runs directory",
  },
  TASK_STOPPED: {
    retryable: false,
    message: "Task force-stopped by user",
    suggestion: "Task was manually stopped, do not auto-retry",
  },
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export function makeError(code: ErrorCode, detail?: string) {
  const info = ERROR_CODES[code];
  return {
    code,
    message: detail ?? info.message,
    retryable: info.retryable,
    suggestion: info.suggestion,
  };
}

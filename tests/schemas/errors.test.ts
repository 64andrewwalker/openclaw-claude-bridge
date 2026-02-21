import { describe, it, expect } from 'vitest';
import { ERROR_CODES, makeError, type ErrorCode } from '../../src/schemas/errors.js';

describe('ERROR_CODES', () => {
  it('has exactly 9 entries', () => {
    expect(Object.keys(ERROR_CODES)).toHaveLength(9);
  });
});

describe('makeError', () => {
  it('returns correct structure with code, message, retryable, and suggestion', () => {
    const err = makeError('ENGINE_TIMEOUT');
    expect(err).toEqual({
      code: 'ENGINE_TIMEOUT',
      message: 'Engine execution timed out',
      retryable: true,
      suggestion: expect.any(String),
    });
    expect(err.suggestion!.length).toBeGreaterThan(0);
  });

  it('overrides default message when detail is provided', () => {
    const err = makeError('ENGINE_TIMEOUT', 'Custom timeout detail');
    expect(err.code).toBe('ENGINE_TIMEOUT');
    expect(err.message).toBe('Custom timeout detail');
    expect(err.retryable).toBe(true);
    expect(err.suggestion).toBeTruthy();
  });

  it.each([
    ['ENGINE_TIMEOUT', true],
    ['ENGINE_CRASH', true],
    ['ENGINE_AUTH', false],
    ['NETWORK_ERROR', true],
    ['WORKSPACE_INVALID', false],
    ['WORKSPACE_NOT_FOUND', false],
    ['REQUEST_INVALID', false],
    ['RUNNER_CRASH_RECOVERY', true],
    ['TASK_STOPPED', false],
  ] as [ErrorCode, boolean][])(
    '%s has retryable=%s',
    (code, expectedRetryable) => {
      const err = makeError(code);
      expect(err.retryable).toBe(expectedRetryable);
    },
  );

  it('every error code has a non-empty suggestion', () => {
    for (const code of Object.keys(ERROR_CODES) as ErrorCode[]) {
      const err = makeError(code);
      expect(err.suggestion, `${code} should have suggestion`).toBeTruthy();
    }
  });
});

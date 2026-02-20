import { describe, it, expect } from 'vitest';
import { ERROR_CODES, makeError, type ErrorCode } from '../../src/schemas/errors';

describe('ERROR_CODES', () => {
  it('has exactly 8 entries', () => {
    expect(Object.keys(ERROR_CODES)).toHaveLength(8);
  });
});

describe('makeError', () => {
  it('returns correct structure with code, message, and retryable', () => {
    const err = makeError('ENGINE_TIMEOUT');
    expect(err).toEqual({
      code: 'ENGINE_TIMEOUT',
      message: 'Engine execution timed out',
      retryable: true,
    });
  });

  it('overrides default message when detail is provided', () => {
    const err = makeError('ENGINE_TIMEOUT', 'Custom timeout detail');
    expect(err.code).toBe('ENGINE_TIMEOUT');
    expect(err.message).toBe('Custom timeout detail');
    expect(err.retryable).toBe(true);
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
  ] as [ErrorCode, boolean][])(
    '%s has retryable=%s',
    (code, expectedRetryable) => {
      const err = makeError(code);
      expect(err.retryable).toBe(expectedRetryable);
    },
  );
});

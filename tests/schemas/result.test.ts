import { describe, it, expect } from 'vitest';
import { validateResult } from '../../src/schemas/result';
import { makeError } from '../../src/schemas/errors';

describe('ResultSchema', () => {
  const validSuccess = {
    run_id: 'run-001',
    status: 'completed' as const,
    summary: 'Task completed successfully',
    session_id: 'session-abc',
    artifacts: ['src/login.ts', 'tests/login.test.ts'],
    duration_ms: 45000,
    token_usage: {
      prompt_tokens: 1200,
      completion_tokens: 800,
      total_tokens: 2000,
    },
  };

  it('accepts a valid success result', () => {
    const result = validateResult(validSuccess);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('completed');
      expect(result.data.summary).toBe('Task completed successfully');
      expect(result.data.session_id).toBe('session-abc');
      expect(result.data.artifacts).toEqual(['src/login.ts', 'tests/login.test.ts']);
      expect(result.data.duration_ms).toBe(45000);
      expect(result.data.token_usage).toEqual({
        prompt_tokens: 1200,
        completion_tokens: 800,
        total_tokens: 2000,
      });
    }
  });

  it('accepts a success result with null token_usage', () => {
    const input = { ...validSuccess, token_usage: null };
    const result = validateResult(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.token_usage).toBeNull();
    }
  });

  it('accepts a failed result with error details', () => {
    const input = {
      ...validSuccess,
      status: 'failed',
      error: {
        code: 'ENGINE_TIMEOUT',
        message: 'Engine execution timed out',
        retryable: true,
      },
    };
    const result = validateResult(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('failed');
      expect(result.data.error).toBeDefined();
      expect(result.data.error!.retryable).toBe(true);
    }
  });

  it('accepts a failed result using makeError helper', () => {
    const error = makeError('ENGINE_TIMEOUT');
    const input = {
      ...validSuccess,
      status: 'failed',
      error,
    };
    const result = validateResult(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.error!.code).toBe('ENGINE_TIMEOUT');
      expect(result.data.error!.retryable).toBe(true);
      expect(result.data.error!.message).toBe('Engine execution timed out');
    }
  });

  it('rejects a failed result WITHOUT error details', () => {
    const input = {
      ...validSuccess,
      status: 'failed',
      // no error field
    };
    const result = validateResult(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i: any) => i.message);
      expect(messages).toContain('error is required when status is failed');
    }
  });

  it('accepts a completed result without error field', () => {
    // completed status should not require error
    const result = validateResult(validSuccess);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.error).toBeUndefined();
    }
  });
});

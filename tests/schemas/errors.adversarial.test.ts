/**
 * Adversarial tests for ERROR_CODES and makeError.
 */
import { describe, it, expect } from "vitest";
import {
  ERROR_CODES,
  makeError,
  type ErrorCode,
} from "../../src/schemas/errors.js";

// ---------------------------------------------------------------------------
// Structural completeness of each error code entry
// ---------------------------------------------------------------------------
describe("ERROR_CODES – structural completeness", () => {
  it("every code has a non-empty message string", () => {
    for (const [code, info] of Object.entries(ERROR_CODES)) {
      expect(typeof info.message, `${code}.message should be string`).toBe(
        "string",
      );
      expect(
        info.message.length,
        `${code}.message should not be empty`,
      ).toBeGreaterThan(0);
    }
  });

  it("every code has a boolean retryable field", () => {
    for (const [code, info] of Object.entries(ERROR_CODES)) {
      expect(typeof info.retryable, `${code}.retryable should be boolean`).toBe(
        "boolean",
      );
    }
  });

  it("every code has a non-empty suggestion string", () => {
    for (const [code, info] of Object.entries(ERROR_CODES)) {
      expect(
        typeof info.suggestion,
        `${code}.suggestion should be string`,
      ).toBe("string");
      expect(
        info.suggestion.length,
        `${code}.suggestion should not be empty`,
      ).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Retryable semantics – consistency checks
// ---------------------------------------------------------------------------
describe("ERROR_CODES – retryable semantic consistency", () => {
  it("TASK_STOPPED is not retryable (user-initiated stop should not auto-retry)", () => {
    expect(ERROR_CODES.TASK_STOPPED.retryable).toBe(false);
  });

  it("ENGINE_AUTH is not retryable (credential failure without intervention is permanent)", () => {
    expect(ERROR_CODES.ENGINE_AUTH.retryable).toBe(false);
  });

  it("WORKSPACE_INVALID is not retryable (invalid path will remain invalid on retry)", () => {
    expect(ERROR_CODES.WORKSPACE_INVALID.retryable).toBe(false);
  });

  it("WORKSPACE_NOT_FOUND is not retryable (directory will not appear on retry)", () => {
    expect(ERROR_CODES.WORKSPACE_NOT_FOUND.retryable).toBe(false);
  });

  it("ENGINE_TIMEOUT is retryable (transient condition)", () => {
    expect(ERROR_CODES.ENGINE_TIMEOUT.retryable).toBe(true);
  });

  it("NETWORK_ERROR is retryable (transient condition)", () => {
    expect(ERROR_CODES.NETWORK_ERROR.retryable).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// makeError – output structure
// ---------------------------------------------------------------------------
describe("makeError – output structure", () => {
  it("always includes the code, message, retryable, and suggestion fields", () => {
    for (const code of Object.keys(ERROR_CODES) as ErrorCode[]) {
      const err = makeError(code);
      expect(err).toHaveProperty("code", code);
      expect(err).toHaveProperty("message");
      expect(err).toHaveProperty("retryable");
      expect(err).toHaveProperty("suggestion");
    }
  });

  it("makeError with empty string detail falls back to default message", () => {
    // Empty string detail is treated the same as absent — the default message is used.
    const err = makeError("ENGINE_TIMEOUT", "");
    // Empty detail falls back to the default message, not an empty string
    expect(err.message).toBe(ERROR_CODES.ENGINE_TIMEOUT.message);
    expect(err.code).toBe("ENGINE_TIMEOUT");
    expect(err.retryable).toBe(true);
  });

  it("uses default message when detail is undefined", () => {
    const err = makeError("ENGINE_TIMEOUT", undefined);
    expect(err.message).toBe("Engine execution timed out");
  });

  it("overrides message when detail is a non-empty string", () => {
    const err = makeError("ENGINE_CRASH", "OOM during inference");
    expect(err.message).toBe("OOM during inference");
  });

  it("preserves suggestion from ERROR_CODES even when detail overrides message", () => {
    const err = makeError("ENGINE_TIMEOUT", "Custom message");
    expect(err.suggestion).toBe(ERROR_CODES.ENGINE_TIMEOUT.suggestion);
  });

  it('BUG CANDIDATE: makeError with detail=null casts null to "null" message via ?? operator', () => {
    // makeError does: detail ?? info.message
    // If called as makeError(code, null as any), null is falsy for ??, so falls back to default.
    // This is actually correct behavior — documenting for completeness.
    const err = makeError("ENGINE_CRASH", null as any);
    // null ?? default = default (correct)
    expect(err.message).toBe(ERROR_CODES.ENGINE_CRASH.message);
  });
});

// ---------------------------------------------------------------------------
// makeError result passes ResultSchema's ErrorSchema
// ---------------------------------------------------------------------------
describe("makeError – ResultSchema ErrorSchema compatibility", () => {
  it("makeError output satisfies ResultSchema error sub-schema for every code", async () => {
    const { validateResult } = await import("../../src/schemas/result.js");
    const validBase = {
      run_id: "run-001",
      status: "failed" as const,
      summary: "Failed",
      session_id: null,
      artifacts: [],
      duration_ms: 100,
      token_usage: null,
    };

    for (const code of Object.keys(ERROR_CODES) as ErrorCode[]) {
      const result = validateResult({ ...validBase, error: makeError(code) });
      expect(
        result.success,
        `makeError('${code}') should pass ResultSchema validation`,
      ).toBe(true);
    }
  });
});

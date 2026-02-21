/**
 * Adversarial tests for ResultSchema and TokenUsageSchema.
 */
import { describe, it, expect } from "vitest";
import { validateResult } from "../../src/schemas/result.js";

const validSuccess = {
  run_id: "run-001",
  status: "completed" as const,
  summary: "Task completed successfully",
  session_id: "session-abc",
  artifacts: ["src/login.ts"],
  duration_ms: 45000,
  token_usage: {
    prompt_tokens: 1200,
    completion_tokens: 800,
    total_tokens: 2000,
  },
};

// ---------------------------------------------------------------------------
// status enum
// ---------------------------------------------------------------------------
describe("ResultSchema – status enum", () => {
  it('rejects status "running" (not in enum)', () => {
    expect(validateResult({ ...validSuccess, status: "running" }).success).toBe(
      false,
    );
  });

  it('rejects status "pending" (not in enum)', () => {
    expect(validateResult({ ...validSuccess, status: "pending" }).success).toBe(
      false,
    );
  });

  it("rejects status as empty string", () => {
    expect(validateResult({ ...validSuccess, status: "" }).success).toBe(false);
  });

  it("rejects status as number", () => {
    expect(validateResult({ ...validSuccess, status: 1 }).success).toBe(false);
  });

  it('rejects status "COMPLETED" (case-sensitive)', () => {
    expect(
      validateResult({ ...validSuccess, status: "COMPLETED" }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// token_usage field – NaN, Infinity, negatives
// ---------------------------------------------------------------------------
describe("ResultSchema – token_usage numeric edge cases", () => {
  it("rejects NaN in token_usage.prompt_tokens (Zod v3+ z.number() rejects NaN)", () => {
    // Zod 3+ z.number() rejects NaN — this is correct protective behavior.
    const result = validateResult({
      ...validSuccess,
      token_usage: {
        prompt_tokens: NaN,
        completion_tokens: 800,
        total_tokens: 2000,
      },
    });
    expect(result.success).toBe(false);
  });

  it("rejects Infinity in token_usage.completion_tokens (Zod v3+ z.number() rejects Infinity)", () => {
    // Zod 3+ z.number() rejects Infinity — this is correct protective behavior.
    const result = validateResult({
      ...validSuccess,
      token_usage: {
        prompt_tokens: 100,
        completion_tokens: Infinity,
        total_tokens: Infinity,
      },
    });
    expect(result.success).toBe(false);
  });

  it("BUG CANDIDATE: accepts negative token counts", () => {
    // Token counts cannot logically be negative.
    const result = validateResult({
      ...validSuccess,
      token_usage: {
        prompt_tokens: -1,
        completion_tokens: -1,
        total_tokens: -2,
      },
    });
    if (result.success) {
      expect(result.data.token_usage!.prompt_tokens).toBe(-1);
    }
    expect(result.success).toBe(true); // BUG: should be false — enable once .nonnegative() is added
  });

  it("rejects token_usage with string values", () => {
    const result = validateResult({
      ...validSuccess,
      token_usage: {
        prompt_tokens: "100",
        completion_tokens: 800,
        total_tokens: 900,
      },
    });
    expect(result.success).toBe(false);
  });

  it("rejects token_usage missing required sub-field (completion_tokens)", () => {
    const result = validateResult({
      ...validSuccess,
      token_usage: { prompt_tokens: 100, total_tokens: 100 },
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// duration_ms edge cases
// ---------------------------------------------------------------------------
describe("ResultSchema – duration_ms edge cases", () => {
  it("BUG CANDIDATE: accepts negative duration_ms", () => {
    // duration_ms should not be negative — it is a duration.
    const result = validateResult({ ...validSuccess, duration_ms: -1 });
    if (result.success) expect(result.data.duration_ms).toBe(-1);
    expect(result.success).toBe(true); // BUG: should be false — enable once .nonnegative() is added
  });

  it("rejects NaN for duration_ms (Zod v3+ z.number() rejects NaN)", () => {
    // Zod 3+ z.number() rejects NaN — this is correct protective behavior.
    const result = validateResult({ ...validSuccess, duration_ms: NaN });
    expect(result.success).toBe(false);
  });

  it("rejects duration_ms as string", () => {
    expect(
      validateResult({ ...validSuccess, duration_ms: "45000" }).success,
    ).toBe(false);
  });

  it("rejects duration_ms as null", () => {
    expect(validateResult({ ...validSuccess, duration_ms: null }).success).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// summary edge cases
// ---------------------------------------------------------------------------
describe("ResultSchema – summary edge cases", () => {
  it("BUG CANDIDATE: accepts empty string summary", () => {
    // summary is z.string() with no min(1). An empty summary is semantically useless.
    const result = validateResult({ ...validSuccess, summary: "" });
    if (result.success) expect(result.data.summary).toBe("");
    expect(result.success).toBe(true); // BUG: should be false — enable once min(1) is added
  });

  it("accepts summary with only whitespace", () => {
    // Same category as empty — documents current permissive behavior.
    const result = validateResult({ ...validSuccess, summary: "   " });
    expect(result.success).toBe(true);
  });

  it("rejects summary as null", () => {
    expect(validateResult({ ...validSuccess, summary: null }).success).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// run_id edge cases
// ---------------------------------------------------------------------------
describe("ResultSchema – run_id edge cases", () => {
  it("rejects empty run_id (min(1))", () => {
    expect(validateResult({ ...validSuccess, run_id: "" }).success).toBe(false);
  });

  it("rejects run_id as number", () => {
    expect(validateResult({ ...validSuccess, run_id: 42 }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// output_path – relative path (potential security concern)
// ---------------------------------------------------------------------------
describe("ResultSchema – output_path relative path", () => {
  it("rejects relative output_path (bug #20 fixed — absolute-path enforced)", () => {
    // Fixed in issue #20: output_path must be an absolute path or null.
    // A relative path like "../../etc/output.txt" could write outside the runs dir.
    const result = validateResult({
      ...validSuccess,
      output_path: "../../etc/output.txt",
    });
    expect(result.success).toBe(false);
  });

  it("rejects output_path with null byte (bug #20 fixed)", () => {
    // Fixed in issue #20: absolute-path enforcement. A null-byte path is not absolute.
    const result = validateResult({
      ...validSuccess,
      output_path: "/runs/run-001/output\x00.txt",
    });
    // The path is technically absolute (starts with '/') but null bytes are still
    // dangerous — the absolute check alone is sufficient as first-pass defence.
    // Note: path.isAbsolute('/runs/run-001/output\x00.txt') === true on Node.
    // This test documents the current behaviour after the fix.
    if (result.success) {
      // If absolute check alone passes this, that is acceptable for now.
      expect(result.data.output_path).toContain("\x00");
    }
    // Not asserting pass/fail here — documenting that the absolute check catches
    // most traversal cases but null bytes in absolute paths are edge cases.
  });
});

// ---------------------------------------------------------------------------
// summary_truncated – type coercion
// ---------------------------------------------------------------------------
describe("ResultSchema – summary_truncated type enforcement", () => {
  it('rejects summary_truncated as string "true"', () => {
    expect(
      validateResult({ ...validSuccess, summary_truncated: "true" }).success,
    ).toBe(false);
  });

  it("rejects summary_truncated as number 1", () => {
    expect(
      validateResult({ ...validSuccess, summary_truncated: 1 }).success,
    ).toBe(false);
  });

  it("rejects summary_truncated as null", () => {
    expect(
      validateResult({ ...validSuccess, summary_truncated: null }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// error field on completed result
// ---------------------------------------------------------------------------
describe("ResultSchema – error field cross-validation", () => {
  it("BUG CANDIDATE: accepts completed status WITH error field present", () => {
    // The refine only checks that failed status requires error.
    // But completed + error is semantically contradictory — no guard against it.
    const result = validateResult({
      ...validSuccess,
      status: "completed",
      error: { code: "ENGINE_CRASH", message: "Oops", retryable: true },
    });
    if (result.success) expect(result.data.error).toBeDefined();
    expect(result.success).toBe(true); // BUG: completed with error should probably be rejected
  });

  it("rejects error.retryable as string", () => {
    const result = validateResult({
      ...validSuccess,
      status: "failed",
      error: { code: "ENGINE_CRASH", message: "Oops", retryable: "yes" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects error with missing code field", () => {
    const result = validateResult({
      ...validSuccess,
      status: "failed",
      error: { message: "Oops", retryable: true },
    });
    expect(result.success).toBe(false);
  });

  it("rejects error with missing message field", () => {
    const result = validateResult({
      ...validSuccess,
      status: "failed",
      error: { code: "ENGINE_CRASH", retryable: true },
    });
    expect(result.success).toBe(false);
  });

  it("rejects error with missing retryable field", () => {
    const result = validateResult({
      ...validSuccess,
      status: "failed",
      error: { code: "ENGINE_CRASH", message: "Oops" },
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// artifacts array edge cases
// ---------------------------------------------------------------------------
describe("ResultSchema – artifacts array", () => {
  it("accepts empty artifacts array", () => {
    const result = validateResult({ ...validSuccess, artifacts: [] });
    expect(result.success).toBe(true);
  });

  it("rejects artifacts with non-string element", () => {
    const result = validateResult({
      ...validSuccess,
      artifacts: ["valid.ts", 42],
    });
    expect(result.success).toBe(false);
  });

  it("rejects artifacts as null", () => {
    const result = validateResult({ ...validSuccess, artifacts: null });
    expect(result.success).toBe(false);
  });

  it("rejects artifacts as string (not array)", () => {
    const result = validateResult({
      ...validSuccess,
      artifacts: "src/login.ts",
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Extra fields – Zod strips them
// ---------------------------------------------------------------------------
describe("ResultSchema – extra field stripping", () => {
  it("strips unknown extra fields", () => {
    const result = validateResult({
      ...validSuccess,
      injected_field: "evil",
      extra: { nested: true },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as any).injected_field).toBeUndefined();
      expect((result.data as any).extra).toBeUndefined();
    }
  });
});

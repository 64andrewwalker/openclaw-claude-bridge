import { describe, it, expect } from "vitest";
import { validateResult } from "../../src/schemas/result.js";
import { makeError } from "../../src/schemas/errors.js";

describe("ResultSchema", () => {
  const validSuccess = {
    run_id: "run-001",
    status: "completed" as const,
    summary: "Task completed successfully",
    session_id: "session-abc",
    artifacts: ["src/login.ts", "tests/login.test.ts"],
    duration_ms: 45000,
    token_usage: {
      prompt_tokens: 1200,
      completion_tokens: 800,
      total_tokens: 2000,
    },
  };

  it("accepts a valid success result", () => {
    const result = validateResult(validSuccess);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe("completed");
      expect(result.data.summary).toBe("Task completed successfully");
      expect(result.data.session_id).toBe("session-abc");
      expect(result.data.artifacts).toEqual([
        "src/login.ts",
        "tests/login.test.ts",
      ]);
      expect(result.data.duration_ms).toBe(45000);
      expect(result.data.token_usage).toEqual({
        prompt_tokens: 1200,
        completion_tokens: 800,
        total_tokens: 2000,
      });
    }
  });

  it("accepts a success result with null token_usage", () => {
    const input = { ...validSuccess, token_usage: null };
    const result = validateResult(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.token_usage).toBeNull();
    }
  });

  it("accepts a failed result with error details", () => {
    const input = {
      ...validSuccess,
      status: "failed",
      error: {
        code: "ENGINE_TIMEOUT",
        message: "Engine execution timed out",
        retryable: true,
      },
    };
    const result = validateResult(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe("failed");
      expect(result.data.error).toBeDefined();
      expect(result.data.error!.retryable).toBe(true);
    }
  });

  it("accepts a failed result using makeError helper", () => {
    const error = makeError("ENGINE_TIMEOUT");
    const input = {
      ...validSuccess,
      status: "failed",
      error,
    };
    const result = validateResult(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.error!.code).toBe("ENGINE_TIMEOUT");
      expect(result.data.error!.retryable).toBe(true);
      expect(result.data.error!.message).toBe("Engine execution timed out");
    }
  });

  it("rejects a failed result WITHOUT error details", () => {
    const input = {
      ...validSuccess,
      status: "failed",
      // no error field
    };
    const result = validateResult(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i: any) => i.message);
      expect(messages).toContain("error is required when status is failed");
    }
  });

  it("accepts a failed result with null session_id", () => {
    const input = {
      run_id: "run-001",
      status: "failed",
      summary: "Failed before session started",
      session_id: null,
      artifacts: [],
      duration_ms: 100,
      token_usage: null,
      error: {
        code: "WORKSPACE_NOT_FOUND",
        message: "Not found",
        retryable: false,
      },
    };
    const result = validateResult(input);
    expect(result.success).toBe(true);
  });

  it("accepts a completed result without error field", () => {
    // completed status should not require error
    const result = validateResult(validSuccess);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.error).toBeUndefined();
    }
  });

  it("accepts files_changed as string array", () => {
    const input = {
      ...validSuccess,
      files_changed: ["src/auth.ts", "tests/auth.test.ts"],
    };
    const result = validateResult(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.files_changed).toEqual([
        "src/auth.ts",
        "tests/auth.test.ts",
      ]);
    }
  });

  it("accepts files_changed as null", () => {
    const input = { ...validSuccess, files_changed: null };
    const result = validateResult(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.files_changed).toBeNull();
    }
  });

  it("defaults files_changed to null when omitted", () => {
    const result = validateResult(validSuccess);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.files_changed).toBeNull();
    }
  });

  it("accepts error with suggestion field", () => {
    const input = {
      ...validSuccess,
      status: "failed",
      error: {
        code: "ENGINE_TIMEOUT",
        message: "Timed out",
        retryable: true,
        suggestion: "Increase timeout",
      },
    };
    const result = validateResult(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.error!.suggestion).toBe("Increase timeout");
    }
  });

  it("accepts output_path as absolute path string", () => {
    // Bug #20 fix: output_path must be absolute or null.
    const input = { ...validSuccess, output_path: "/runs/run-001/output.txt" };
    const result = validateResult(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.output_path).toBe("/runs/run-001/output.txt");
    }
  });

  it("rejects output_path as relative string (bug #20 fix)", () => {
    const input = { ...validSuccess, output_path: "output.txt" };
    const result = validateResult(input);
    expect(result.success).toBe(false);
  });

  it("accepts output_path as null", () => {
    const input = { ...validSuccess, output_path: null };
    const result = validateResult(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.output_path).toBeNull();
    }
  });

  it("defaults output_path to null when omitted", () => {
    const result = validateResult(validSuccess);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.output_path).toBeNull();
    }
  });

  it("accepts summary_truncated as true", () => {
    const input = { ...validSuccess, summary_truncated: true };
    const result = validateResult(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.summary_truncated).toBe(true);
    }
  });

  it("defaults summary_truncated to false when omitted", () => {
    const result = validateResult(validSuccess);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.summary_truncated).toBe(false);
    }
  });

  // Fix #3: negative token counts
  it("rejects negative prompt_tokens", () => {
    const input = {
      ...validSuccess,
      token_usage: {
        prompt_tokens: -1,
        completion_tokens: 800,
        total_tokens: 799,
      },
    };
    const result = validateResult(input);
    expect(result.success).toBe(false);
  });

  it("rejects negative completion_tokens", () => {
    const input = {
      ...validSuccess,
      token_usage: {
        prompt_tokens: 100,
        completion_tokens: -5,
        total_tokens: 95,
      },
    };
    const result = validateResult(input);
    expect(result.success).toBe(false);
  });

  it("rejects negative total_tokens", () => {
    const input = {
      ...validSuccess,
      token_usage: {
        prompt_tokens: 100,
        completion_tokens: 800,
        total_tokens: -900,
      },
    };
    const result = validateResult(input);
    expect(result.success).toBe(false);
  });

  it("rejects non-integer token counts (floats)", () => {
    const input = {
      ...validSuccess,
      token_usage: {
        prompt_tokens: 1.5,
        completion_tokens: 800,
        total_tokens: 801.5,
      },
    };
    const result = validateResult(input);
    expect(result.success).toBe(false);
  });

  it("accepts zero token counts", () => {
    const input = {
      ...validSuccess,
      token_usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    };
    const result = validateResult(input);
    expect(result.success).toBe(true);
  });

  // Fix #4: negative duration_ms
  it("rejects negative duration_ms", () => {
    const input = { ...validSuccess, duration_ms: -1 };
    const result = validateResult(input);
    expect(result.success).toBe(false);
  });

  it("accepts zero duration_ms", () => {
    const input = { ...validSuccess, duration_ms: 0 };
    const result = validateResult(input);
    expect(result.success).toBe(true);
  });

  // Fix #6: completed status with error present
  it("rejects completed status with error field present", () => {
    const input = {
      ...validSuccess,
      status: "completed" as const,
      error: { code: "ENGINE_TIMEOUT", message: "oops", retryable: true },
    };
    const result = validateResult(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i: any) => i.message);
      expect(
        messages.some((m: string) => m.toLowerCase().includes("completed")),
      ).toBe(true);
    }
  });

  it("accepts empty string summary (engine produced no output)", () => {
    const input = { ...validSuccess, summary: "" };
    const result = validateResult(input);
    expect(result.success).toBe(true);
  });
});

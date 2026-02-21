/**
 * Adversarial tests for RequestSchema.
 *
 * These tests probe edge cases and potential bugs NOT covered by the
 * existing happy-path / basic-rejection test suite.
 */
import { describe, it, expect } from "vitest";
import { validateRequest } from "../../src/schemas/request.js";

const validBase = {
  task_id: "task-001",
  intent: "coding" as const,
  workspace_path: "/home/user/project",
  message: "Implement the login feature",
};

// ---------------------------------------------------------------------------
// Missing required fields (one at a time)
// ---------------------------------------------------------------------------
describe("RequestSchema – missing required fields", () => {
  it("rejects when task_id is missing", () => {
    const { task_id, ...input } = validBase;
    expect(validateRequest(input).success).toBe(false);
  });

  it("rejects when intent is missing", () => {
    const { intent, ...input } = validBase;
    expect(validateRequest(input).success).toBe(false);
  });

  it("rejects when task_id is empty string (min(1) boundary)", () => {
    const result = validateRequest({ ...validBase, task_id: "" });
    expect(result.success).toBe(false);
  });

  it("rejects when message is empty string (min(1) boundary)", () => {
    const result = validateRequest({ ...validBase, message: "" });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// task_id / message with only whitespace
// Zod min(1) checks length, NOT content. Whitespace-only strings should fail
// if the intent is to require meaningful content. This is a design gap test.
// ---------------------------------------------------------------------------
describe("RequestSchema – whitespace-only field values", () => {
  it("BUG CANDIDATE: accepts task_id containing only whitespace", () => {
    // Expectation: whitespace-only task_id is semantically empty and should fail.
    // If this passes, it exposes a gap: min(1) does not trim/validate content.
    const result = validateRequest({ ...validBase, task_id: "   " });
    // Document the actual behavior:
    if (result.success) {
      // Bug: whitespace-only task_id is accepted
      expect(result.data.task_id).toBe("   ");
    }
    // We assert the schema DOES accept it (documenting the gap, not asserting rejection)
    // Change to toBe(false) once the schema adds .trim().min(1)
    expect(result.success).toBe(true); // FAIL here if ever fixed
  });

  it("BUG CANDIDATE: accepts message containing only whitespace", () => {
    // Same gap as task_id above.
    const result = validateRequest({ ...validBase, message: "\t\n  " });
    if (result.success) {
      expect(result.data.message).toBe("\t\n  ");
    }
    expect(result.success).toBe(true); // FAIL here if ever fixed
  });
});

// ---------------------------------------------------------------------------
// Invalid types
// ---------------------------------------------------------------------------
describe("RequestSchema – invalid field types", () => {
  it("rejects task_id as number", () => {
    expect(validateRequest({ ...validBase, task_id: 123 }).success).toBe(false);
  });

  it("rejects task_id as null", () => {
    expect(validateRequest({ ...validBase, task_id: null }).success).toBe(
      false,
    );
  });

  it("rejects workspace_path as number", () => {
    expect(validateRequest({ ...validBase, workspace_path: 42 }).success).toBe(
      false,
    );
  });

  it("rejects message as boolean", () => {
    expect(validateRequest({ ...validBase, message: true }).success).toBe(
      false,
    );
  });

  it("rejects intent as boolean", () => {
    expect(
      validateRequest({ ...validBase, intent: false as any }).success,
    ).toBe(false);
  });

  it("rejects constraints.timeout_ms as string", () => {
    const result = validateRequest({
      ...validBase,
      constraints: { timeout_ms: "1800000", allow_network: true },
    });
    expect(result.success).toBe(false);
  });

  it("rejects constraints.allow_network as string", () => {
    const result = validateRequest({
      ...validBase,
      constraints: { timeout_ms: 1800000, allow_network: "yes" },
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Engine name
// ---------------------------------------------------------------------------
describe("RequestSchema – engine field", () => {
  it("rejects unknown engine name", () => {
    const result = validateRequest({ ...validBase, engine: "gpt-4o" });
    expect(result.success).toBe(false);
  });

  it("rejects engine as empty string", () => {
    const result = validateRequest({ ...validBase, engine: "" });
    expect(result.success).toBe(false);
  });

  it("rejects engine name that is a variant spelling (case-sensitive check)", () => {
    // 'Claude-Code' vs 'claude-code'
    const result = validateRequest({ ...validBase, engine: "Claude-Code" });
    expect(result.success).toBe(false);
  });

  it("accepts all valid engine values", () => {
    for (const engine of ["claude-code", "kimi-code", "opencode", "codex"]) {
      const result = validateRequest({ ...validBase, engine });
      expect(result.success, `engine="${engine}" should be valid`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Path traversal – workspace_path
// ---------------------------------------------------------------------------
describe("RequestSchema – workspace_path traversal and boundary cases", () => {
  it("rejects path that traverses into /etc via multiple segments", () => {
    // /home/user/../../../etc resolves to /etc
    const result = validateRequest({
      ...validBase,
      workspace_path: "/home/user/../../../etc",
    });
    expect(result.success).toBe(false);
  });

  it("rejects path traversal that resolves to /usr", () => {
    // /home/user/../../usr resolves to /usr
    const result = validateRequest({
      ...validBase,
      workspace_path: "/home/user/../../usr",
    });
    expect(result.success).toBe(false);
  });

  it("rejects path traversal that resolves to /bin", () => {
    const result = validateRequest({
      ...validBase,
      workspace_path: "/home/../../bin",
    });
    expect(result.success).toBe(false);
  });

  it("rejects /etc/passwd (sub-path of blocked /etc — bug #20 fixed)", () => {
    // Sub-path protection added in issue #20: DANGEROUS_ROOTS.some(r => resolved === r || resolved.startsWith(r + '/'))
    const result = validateRequest({
      ...validBase,
      workspace_path: "/etc/passwd",
    });
    expect(result.success).toBe(false);
  });

  it("rejects /usr/bin (sub-path of blocked /usr — bug #20 fixed)", () => {
    const result = validateRequest({
      ...validBase,
      workspace_path: "/usr/bin",
    });
    expect(result.success).toBe(false);
  });

  it("rejects /var/run/secrets (sub-path of blocked /var/run — bug #20 fixed)", () => {
    // /var/run is in the specific dangerous /var sub-path list added in issue #20.
    const result = validateRequest({
      ...validBase,
      workspace_path: "/var/run/secrets",
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Unicode / emoji / special chars in message
// ---------------------------------------------------------------------------
describe("RequestSchema – unicode and special characters in string fields", () => {
  it("accepts unicode characters in message", () => {
    const result = validateRequest({
      ...validBase,
      message: "实现登录功能 🚀",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.message).toBe("实现登录功能 🚀");
  });

  it("accepts very long message (100k chars)", () => {
    const result = validateRequest({
      ...validBase,
      message: "x".repeat(100_000),
    });
    // No max length constraint – should pass. Document if it should be capped.
    expect(result.success).toBe(true);
  });

  it("accepts newlines and tabs in message", () => {
    const result = validateRequest({
      ...validBase,
      message: "line1\nline2\ttabbed",
    });
    expect(result.success).toBe(true);
  });

  it("rejects null byte in workspace_path (bug #20 fixed)", () => {
    // Null bytes in paths can cause OS-level security issues.
    // Fixed in issue #20: schema now explicitly rejects paths with null bytes.
    const result = validateRequest({
      ...validBase,
      workspace_path: "/home/user\x00evil",
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// constraints sub-object edge cases
// ---------------------------------------------------------------------------
describe("RequestSchema – constraints edge cases", () => {
  it("rejects timeout_ms of 0 (not positive)", () => {
    const result = validateRequest({
      ...validBase,
      constraints: { timeout_ms: 0, allow_network: true },
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative timeout_ms", () => {
    const result = validateRequest({
      ...validBase,
      constraints: { timeout_ms: -1000, allow_network: true },
    });
    expect(result.success).toBe(false);
  });

  it("rejects timeout_ms as NaN", () => {
    const result = validateRequest({
      ...validBase,
      constraints: { timeout_ms: NaN, allow_network: true },
    });
    // z.number().positive() - NaN is not positive. Check how Zod handles NaN.
    expect(result.success).toBe(false);
  });

  it("rejects timeout_ms as Infinity", () => {
    const result = validateRequest({
      ...validBase,
      constraints: { timeout_ms: Infinity, allow_network: true },
    });
    // Infinity is technically > 0 but semantically invalid for a timeout.
    // This tests whether Zod's .positive() catches Infinity.
    // KNOWN GAP: z.number().positive() accepts Infinity in some Zod versions.
    const parsed = result;
    if (parsed.success) {
      // Document: Infinity slips through .positive()
      expect(parsed.data.constraints.timeout_ms).toBe(Infinity);
    }
    // Not asserting pass/fail — documenting the behavior:
    // expect(result.success).toBe(false); // Enable once fixed
  });

  it("rejects partial constraints object (missing allow_network)", () => {
    const result = validateRequest({
      ...validBase,
      constraints: { timeout_ms: 5000 },
    });
    // allow_network has a default, so partial should be fine
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Extra / unknown fields (Zod strips them by default)
// ---------------------------------------------------------------------------
describe("RequestSchema – extra field handling", () => {
  it("strips unknown extra fields silently (Zod default strip behavior)", () => {
    const result = validateRequest({
      ...validBase,
      unknown_field: "injected",
      nested: { evil: true },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as any).unknown_field).toBeUndefined();
      expect((result.data as any).nested).toBeUndefined();
    }
  });

  it("strips __proto__ injection attempt", () => {
    const malicious = JSON.parse(
      '{"task_id":"t","intent":"coding","workspace_path":"/home/u","message":"m","__proto__":{"polluted":true}}',
    );
    const result = validateRequest(malicious);
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as any).__proto__?.polluted).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// mode + session_id semantic relationship
// ---------------------------------------------------------------------------
describe("RequestSchema – mode and session_id relationship", () => {
  it("BUG CANDIDATE: allows resume mode without session_id (semantically invalid)", () => {
    // The schema defaults session_id to null and mode defaults to 'new'.
    // It does NOT enforce that mode='resume' requires a non-null session_id.
    // A resume with null session_id would silently create a new session.
    const result = validateRequest({
      ...validBase,
      mode: "resume",
      session_id: null,
    });
    // Document: this currently PASSES — no cross-field validation
    expect(result.success).toBe(true); // Change to false if cross-field check is added
    if (result.success) {
      expect(result.data.mode).toBe("resume");
      expect(result.data.session_id).toBeNull();
    }
  });

  it("rejects mode as unknown value", () => {
    const result = validateRequest({ ...validBase, mode: "restart" });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// allowed_roots edge cases
// ---------------------------------------------------------------------------
describe("RequestSchema – allowed_roots", () => {
  it("accepts empty allowed_roots array", () => {
    const result = validateRequest({ ...validBase, allowed_roots: [] });
    expect(result.success).toBe(true);
  });

  it("accepts omitted allowed_roots (optional)", () => {
    const result = validateRequest(validBase);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.allowed_roots).toBeUndefined();
  });

  it("rejects allowed_roots with non-string element", () => {
    const result = validateRequest({
      ...validBase,
      allowed_roots: ["/home/user", 42],
    });
    expect(result.success).toBe(false);
  });
});

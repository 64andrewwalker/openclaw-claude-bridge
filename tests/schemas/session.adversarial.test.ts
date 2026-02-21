/**
 * Adversarial tests for SessionSchema.
 */
import { describe, it, expect } from "vitest";
import { SessionSchema } from "../../src/schemas/session.js";

const validSession = {
  run_id: "run-001",
  engine: "claude-code",
  session_id: "session-abc",
  state: "created" as const,
  pid: 1234,
  created_at: "2026-01-01T00:00:00Z",
  last_active_at: "2026-01-01T00:01:00Z",
};

// ---------------------------------------------------------------------------
// run_id edge cases
// ---------------------------------------------------------------------------
describe("SessionSchema – run_id", () => {
  it("rejects empty run_id (min(1) enforced)", () => {
    // SessionSchema enforces min(1) on run_id — empty strings are rejected.
    const result = SessionSchema.safeParse({ ...validSession, run_id: "" });
    expect(result.success).toBe(false);
  });

  it("rejects run_id as null", () => {
    const result = SessionSchema.safeParse({ ...validSession, run_id: null });
    expect(result.success).toBe(false);
  });

  it("rejects run_id as number", () => {
    const result = SessionSchema.safeParse({ ...validSession, run_id: 1 });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// pid edge cases
// ---------------------------------------------------------------------------
describe("SessionSchema – pid edge cases", () => {
  it("rejects pid as negative number (must be positive integer)", () => {
    // PIDs are always positive integers on POSIX systems. A negative pid is invalid.
    const result = SessionSchema.safeParse({ ...validSession, pid: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects pid as zero (must be >= 1)", () => {
    // PID 0 is the swapper/idle process on POSIX; it cannot be a valid task pid.
    const result = SessionSchema.safeParse({ ...validSession, pid: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects pid as float (must be an integer)", () => {
    // PIDs are integers. A float like 1234.5 is not a valid PID.
    const result = SessionSchema.safeParse({ ...validSession, pid: 1234.5 });
    expect(result.success).toBe(false);
  });

  it("rejects pid as string", () => {
    const result = SessionSchema.safeParse({ ...validSession, pid: "1234" });
    expect(result.success).toBe(false);
  });

  it("rejects pid as boolean", () => {
    const result = SessionSchema.safeParse({ ...validSession, pid: true });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// state enum
// ---------------------------------------------------------------------------
describe("SessionSchema – state enum", () => {
  it('rejects unknown state "queued"', () => {
    const result = SessionSchema.safeParse({
      ...validSession,
      state: "queued",
    });
    expect(result.success).toBe(false);
  });

  it("rejects state as empty string", () => {
    const result = SessionSchema.safeParse({ ...validSession, state: "" });
    expect(result.success).toBe(false);
  });

  it("rejects state as null", () => {
    const result = SessionSchema.safeParse({ ...validSession, state: null });
    expect(result.success).toBe(false);
  });

  it("rejects state as number", () => {
    const result = SessionSchema.safeParse({ ...validSession, state: 1 });
    expect(result.success).toBe(false);
  });

  it('rejects state "RUNNING" (case-sensitive)', () => {
    const result = SessionSchema.safeParse({
      ...validSession,
      state: "RUNNING",
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// engine enum
// ---------------------------------------------------------------------------
describe("SessionSchema – engine field", () => {
  it('rejects unknown engine "gpt-4o"', () => {
    const result = SessionSchema.safeParse({
      ...validSession,
      engine: "gpt-4o",
    });
    expect(result.success).toBe(false);
  });

  it("rejects engine as empty string", () => {
    const result = SessionSchema.safeParse({ ...validSession, engine: "" });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// datetime fields
// ---------------------------------------------------------------------------
describe("SessionSchema – datetime field validation", () => {
  it("rejects malformed created_at (not ISO 8601)", () => {
    const result = SessionSchema.safeParse({
      ...validSession,
      created_at: "2026-01-01",
    });
    expect(result.success).toBe(false);
  });

  it("rejects created_at as empty string", () => {
    const result = SessionSchema.safeParse({ ...validSession, created_at: "" });
    expect(result.success).toBe(false);
  });

  it("rejects created_at as number (unix timestamp)", () => {
    const result = SessionSchema.safeParse({
      ...validSession,
      created_at: 1735689600000,
    });
    expect(result.success).toBe(false);
  });

  it("rejects last_active_at as null", () => {
    const result = SessionSchema.safeParse({
      ...validSession,
      last_active_at: null,
    });
    expect(result.success).toBe(false);
  });

  it("BUG CANDIDATE: accepts last_active_at before created_at (no ordering constraint)", () => {
    // The schema does not validate that last_active_at >= created_at.
    // A session with last_active_at in the past relative to created_at is nonsensical.
    const result = SessionSchema.safeParse({
      ...validSession,
      created_at: "2026-01-01T12:00:00Z",
      last_active_at: "2026-01-01T00:00:00Z", // before created_at
    });
    if (result.success) {
      expect(result.data.last_active_at < result.data.created_at).toBe(true);
    }
    expect(result.success).toBe(true); // BUG: temporal ordering is not enforced
  });
});

// ---------------------------------------------------------------------------
// Missing required fields
// ---------------------------------------------------------------------------
describe("SessionSchema – missing required fields", () => {
  it("rejects missing state field", () => {
    const { state, ...noState } = validSession;
    expect(SessionSchema.safeParse(noState).success).toBe(false);
  });

  it("rejects missing run_id field", () => {
    const { run_id, ...noRunId } = validSession;
    expect(SessionSchema.safeParse(noRunId).success).toBe(false);
  });

  it("rejects missing created_at field", () => {
    const { created_at, ...noCreatedAt } = validSession;
    expect(SessionSchema.safeParse(noCreatedAt).success).toBe(false);
  });

  it("rejects missing last_active_at field", () => {
    const { last_active_at, ...noLastActive } = validSession;
    expect(SessionSchema.safeParse(noLastActive).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Extra fields
// ---------------------------------------------------------------------------
describe("SessionSchema – extra field stripping", () => {
  it("strips unknown extra fields", () => {
    const result = SessionSchema.safeParse({
      ...validSession,
      extra_field: "injected",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as any).extra_field).toBeUndefined();
    }
  });
});

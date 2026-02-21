import { describe, it, expect } from "vitest";
import { SessionSchema } from "../../src/schemas/session";

describe("SessionSchema", () => {
  const validSession = {
    run_id: "run-001",
    engine: "claude-code",
    session_id: "session-abc",
    state: "created" as const,
    pid: 1234,
    created_at: "2026-01-01T00:00:00Z",
    last_active_at: "2026-01-01T00:01:00Z",
  };

  it.each(["created", "running", "stopping", "completed", "failed"] as const)(
    'accepts state "%s"',
    (state) => {
      const result = SessionSchema.safeParse({ ...validSession, state });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.state).toBe(state);
      }
    },
  );

  it("rejects an invalid state", () => {
    const result = SessionSchema.safeParse({
      ...validSession,
      state: "paused",
    });
    expect(result.success).toBe(false);
  });

  it("accepts nullable pid", () => {
    const result = SessionSchema.safeParse({ ...validSession, pid: null });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.pid).toBeNull();
    }
  });

  it("accepts nullable session_id", () => {
    const result = SessionSchema.safeParse({
      ...validSession,
      session_id: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.session_id).toBeNull();
    }
  });

  // Fix #7: empty string run_id
  it("rejects empty string run_id", () => {
    const result = SessionSchema.safeParse({ ...validSession, run_id: "" });
    expect(result.success).toBe(false);
  });

  // Fix #8: invalid pid values
  it("rejects zero pid", () => {
    const result = SessionSchema.safeParse({ ...validSession, pid: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects negative pid", () => {
    const result = SessionSchema.safeParse({ ...validSession, pid: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects float pid", () => {
    const result = SessionSchema.safeParse({ ...validSession, pid: 1234.5 });
    expect(result.success).toBe(false);
  });

  it("accepts a positive integer pid", () => {
    const result = SessionSchema.safeParse({ ...validSession, pid: 9999 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.pid).toBe(9999);
    }
  });

  it("defaults pid to null when omitted", () => {
    const { pid, ...noP } = validSession;
    const result = SessionSchema.safeParse(noP);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.pid).toBeNull();
    }
  });
});

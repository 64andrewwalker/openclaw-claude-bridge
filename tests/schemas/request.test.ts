import { describe, it, expect } from "vitest";
import { validateRequest } from "../../src/schemas/request";

describe("RequestSchema", () => {
  const validBase = {
    task_id: "task-001",
    intent: "coding" as const,
    workspace_path: "/home/user/project",
    message: "Implement the login feature",
  };

  it("accepts a valid new task request", () => {
    const input = {
      ...validBase,
      engine: "claude-code",
      mode: "new",
    };
    const result = validateRequest(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.intent).toBe("coding");
      expect(result.data.workspace_path).toBe("/home/user/project");
      expect(result.data.message).toBe("Implement the login feature");
      expect(result.data.mode).toBe("new");
      expect(result.data.engine).toBe("claude-code");
    }
  });

  it("applies defaults for engine, mode, session_id, and constraints", () => {
    const result = validateRequest(validBase);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.engine).toBe("claude-code");
      expect(result.data.mode).toBe("new");
      expect(result.data.session_id).toBeNull();
      expect(result.data.constraints.timeout_ms).toBe(1800000);
      expect(result.data.constraints.allow_network).toBe(true);
    }
  });

  it("accepts a resume request with session_id", () => {
    const input = {
      ...validBase,
      mode: "resume",
      session_id: "session-abc-123",
    };
    const result = validateRequest(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mode).toBe("resume");
      expect(result.data.session_id).toBe("session-abc-123");
    }
  });

  it("rejects a request with missing workspace", () => {
    const { workspace_path, ...noWorkspace } = validBase;
    const result = validateRequest(noWorkspace);
    expect(result.success).toBe(false);
  });

  it("rejects a request with empty workspace string", () => {
    const input = { ...validBase, workspace_path: "" };
    const result = validateRequest(input);
    expect(result.success).toBe(false);
  });

  it.each([
    "/",
    "/etc",
    "/usr",
    "/System",
    "/bin",
    "/sbin",
    "/var/run",
    "/var/root",
    "/var/db",
    "/var/spool",
  ])("rejects dangerous workspace root path: %s", (dangerousPath) => {
    const input = { ...validBase, workspace_path: dangerousPath };
    const result = validateRequest(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i: any) => i.message);
      expect(messages).toContain("Workspace path is a disallowed root path");
    }
  });

  it("rejects a workspace path that is a sub-path of a dangerous root", () => {
    // /etc/myapp/config is under /etc which is a dangerous root.
    // After the sub-path fix, this must be rejected.
    const input = { ...validBase, workspace_path: "/etc/myapp/config" };
    const result = validateRequest(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i: any) => i.message);
      expect(messages).toContain("Workspace path is a disallowed root path");
    }
  });

  it("rejects a request with missing message", () => {
    const { message, ...noMessage } = validBase;
    const result = validateRequest(noMessage);
    expect(result.success).toBe(false);
  });

  it("rejects a request with invalid intent", () => {
    const input = { ...validBase, intent: "hacking" };
    const result = validateRequest(input);
    expect(result.success).toBe(false);
  });

  it("rejects traversal paths that resolve to dangerous roots", () => {
    const input = { ...validBase, workspace_path: "/home/user/../../etc" };
    const result = validateRequest(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i: any) => i.message);
      expect(messages).toContain("Workspace path is a disallowed root path");
    }
  });

  // Fix #1: whitespace-only task_id
  it("rejects a whitespace-only task_id", () => {
    const input = { ...validBase, task_id: "   " };
    const result = validateRequest(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i: any) => i.message);
      expect(
        messages.some(
          (m: string) =>
            m.toLowerCase().includes("blank") ||
            m.toLowerCase().includes("task_id"),
        ),
      ).toBe(true);
    }
  });

  it("does not mutate (trim) task_id — preserves original value with surrounding spaces trimmed check via refine", () => {
    // task_id with internal spaces (not just whitespace) should be accepted
    const input = { ...validBase, task_id: "task 001" };
    const result = validateRequest(input);
    expect(result.success).toBe(true);
    if (result.success) {
      // refine should not transform value — original is preserved
      expect(result.data.task_id).toBe("task 001");
    }
  });

  // Fix #1: whitespace-only message
  it("rejects a whitespace-only message", () => {
    const input = { ...validBase, message: "   " };
    const result = validateRequest(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i: any) => i.message);
      expect(
        messages.some(
          (m: string) =>
            m.toLowerCase().includes("blank") ||
            m.toLowerCase().includes("message"),
        ),
      ).toBe(true);
    }
  });

  // Fix #2: resume with null session_id
  it("rejects mode=resume when session_id is null", () => {
    const input = { ...validBase, mode: "resume", session_id: null };
    const result = validateRequest(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i: any) => i.message);
      expect(messages).toContain("resume requires session_id");
    }
  });

  it("rejects mode=resume when session_id is omitted (defaults to null)", () => {
    const input = { ...validBase, mode: "resume" };
    const result = validateRequest(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i: any) => i.message);
      expect(messages).toContain("resume requires session_id");
    }
  });

  it("accepts mode=new with null session_id", () => {
    const input = { ...validBase, mode: "new", session_id: null };
    const result = validateRequest(input);
    expect(result.success).toBe(true);
  });

  // Security: null bytes in workspace_path
  it("rejects a workspace path containing null bytes", () => {
    const input = { ...validBase, workspace_path: "/home/user/proj\x00ect" };
    const result = validateRequest(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i: any) => i.message);
      expect(messages).toContain(
        "Workspace path must not contain null bytes",
      );
    }
  });

  // Security: /var/folders is a legitimate macOS user-space temp directory
  it("accepts /var/folders as a legitimate macOS user-space temp directory", () => {
    const input = {
      ...validBase,
      workspace_path: "/var/folders/abc123/myproject",
    };
    const result = validateRequest(input);
    expect(result.success).toBe(true);
  });
});

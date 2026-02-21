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
});

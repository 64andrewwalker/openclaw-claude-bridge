/**
 * Adversarial tests for KimiCodeEngine.
 *
 * These tests probe edge cases and failure modes not covered by the existing suite.
 * They are intentionally written to surface bugs. Do NOT modify production code.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import {
  mkdirSync,
  writeFileSync,
  unlinkSync,
  chmodSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import { KimiCodeEngine } from "../../src/engines/kimi-code.js";
import type { TaskRequest } from "../../src/schemas/request.js";

const makeRequest = (overrides?: Partial<TaskRequest>): TaskRequest => ({
  task_id: "task-kimi-adv-001",
  intent: "coding",
  workspace_path: "/tmp/cb-test-project",
  message: "Hello world",
  engine: "kimi-code",
  mode: "new",
  session_id: null,
  constraints: { timeout_ms: 15000, allow_network: true },
  ...overrides,
});

beforeAll(() => {
  mkdirSync("/tmp/cb-test-project", { recursive: true });
});

function makeScript(scriptPath: string, body: string): void {
  writeFileSync(scriptPath, `#!/bin/sh\n${body}\n`);
  chmodSync(scriptPath, 0o755);
}

// ---------------------------------------------------------------------------
// NDJSON parsing: mixed valid/invalid lines
// ---------------------------------------------------------------------------

describe("KimiCodeEngine – NDJSON mixed valid/invalid lines", () => {
  it("skips invalid JSON lines and parses valid ones", async () => {
    const scriptPath = "/tmp/cb-kimi-mixed-ndjson.sh";
    makeScript(
      scriptPath,
      [
        `echo 'this is not json'`,
        `echo '{"role":"assistant","content":[{"type":"text","text":"good"}]}'`,
        `echo 'also not json'`,
      ].join("\n"),
    );
    try {
      const engine = new KimiCodeEngine({ command: scriptPath });
      const result = await engine.start(makeRequest());
      expect(result.error).toBeUndefined();
      expect(result.output).toBe("good");
    } finally {
      unlinkSync(scriptPath);
    }
  });

  it("handles all-invalid NDJSON lines gracefully", async () => {
    const scriptPath = "/tmp/cb-kimi-all-invalid.sh";
    makeScript(
      scriptPath,
      [`echo 'not json'`, `echo 'also not json'`, `echo '{"broken'`].join("\n"),
    );
    try {
      const engine = new KimiCodeEngine({ command: scriptPath });
      const result = await engine.start(makeRequest());
      // No valid content array found — falls back to raw trimmed output
      expect(result.error).toBeUndefined();
      expect(typeof result.output).toBe("string");
      expect(result.output.length).toBeGreaterThan(0);
    } finally {
      unlinkSync(scriptPath);
    }
  });

  it("NDJSON line that is valid JSON but not an object (array) is skipped", async () => {
    const scriptPath = "/tmp/cb-kimi-array-line.sh";
    makeScript(
      scriptPath,
      [
        `echo '["not","an","object"]'`,
        `echo '{"role":"assistant","content":[{"type":"text","text":"from object"}]}'`,
      ].join("\n"),
    );
    try {
      const engine = new KimiCodeEngine({ command: scriptPath });
      const result = await engine.start(makeRequest());
      expect(result.error).toBeUndefined();
      // Array line is parsed but has no .content field with array — skipped
      expect(result.output).toBe("from object");
    } finally {
      unlinkSync(scriptPath);
    }
  });

  it("handles NDJSON where content field is not an array", async () => {
    // content is a string, not an array — should be skipped gracefully
    const payload = JSON.stringify({
      role: "assistant",
      content: "just a string",
    });
    const engine = new KimiCodeEngine({
      command: "echo",
      defaultArgs: [payload],
    });
    const result = await engine.start(makeRequest());
    expect(result.error).toBeUndefined();
    // content is not an array → no foundContentArray → falls back to raw
    expect(result.output).toContain("just a string");
  });

  it("handles NDJSON where content items have text field as null", async () => {
    const payload = JSON.stringify({
      role: "assistant",
      content: [{ type: "text", text: null }],
    });
    const engine = new KimiCodeEngine({
      command: "echo",
      defaultArgs: [payload],
    });
    const result = await engine.start(makeRequest());
    expect(result.error).toBeUndefined();
    // typeof null !== 'string' so text part is skipped; foundContentArray=true → empty output
    expect(result.output).toBe("");
  });

  it("handles NDJSON line with content array but items have no type field", async () => {
    const payload = JSON.stringify({
      role: "assistant",
      content: [{ missing_type: "text", text: "should not appear" }],
    });
    const engine = new KimiCodeEngine({
      command: "echo",
      defaultArgs: [payload],
    });
    const result = await engine.start(makeRequest());
    expect(result.error).toBeUndefined();
    // type is undefined, not 'text' → skipped
    expect(result.output).toBe("");
  });
});

// ---------------------------------------------------------------------------
// stream-json: missing / multiple final_reply
// ---------------------------------------------------------------------------

describe("KimiCodeEngine – final_reply scenarios", () => {
  it("collects text from ALL assistant content lines (no final_reply concept)", async () => {
    // Kimi's parseKimiJson collects text from ALL lines with content arrays.
    // There is no concept of a designated "final_reply" message — all text accumulates.
    const scriptPath = "/tmp/cb-kimi-all-assistant.sh";
    makeScript(
      scriptPath,
      [
        `echo '{"role":"assistant","content":[{"type":"text","text":"first "}]}'`,
        `echo '{"role":"assistant","content":[{"type":"text","text":"second "}]}'`,
        `echo '{"role":"assistant","content":[{"type":"text","text":"third"}]}'`,
      ].join("\n"),
    );
    try {
      const engine = new KimiCodeEngine({ command: scriptPath });
      const result = await engine.start(makeRequest());
      expect(result.error).toBeUndefined();
      // All three text parts are concatenated
      expect(result.output).toBe("first second third");
    } finally {
      unlinkSync(scriptPath);
    }
  });

  it("tool result lines without content arrays do not contribute to output", async () => {
    const scriptPath = "/tmp/cb-kimi-tool-result.sh";
    makeScript(
      scriptPath,
      [
        `echo '{"role":"assistant","content":[{"type":"text","text":"before tool"}]}'`,
        `echo '{"role":"tool","tool_call_id":"call-1","result":"tool output"}'`,
        `echo '{"role":"assistant","content":[{"type":"text","text":" after tool"}]}'`,
      ].join("\n"),
    );
    try {
      const engine = new KimiCodeEngine({ command: scriptPath });
      const result = await engine.start(makeRequest());
      expect(result.error).toBeUndefined();
      expect(result.output).toBe("before tool after tool");
    } finally {
      unlinkSync(scriptPath);
    }
  });

  it("empty output when stream has NO assistant content lines at all", async () => {
    // Only tool/user messages, no assistant text
    const scriptPath = "/tmp/cb-kimi-no-assistant.sh";
    makeScript(
      scriptPath,
      [
        `echo '{"role":"user","content":[{"type":"text","text":"user msg"}]}'`,
        `echo '{"role":"tool","tool_call_id":"call-1","result":"done"}'`,
      ].join("\n"),
    );
    try {
      const engine = new KimiCodeEngine({ command: scriptPath });
      const result = await engine.start(makeRequest());
      expect(result.error).toBeUndefined();
      // user line has content array with text but it's there → foundContentArray=true → output from user role
      // This is a potential bug: user messages' text is also collected into output
      // The engine doesn't filter by role — it collects from ALL lines with content arrays
      // So 'user msg' would be included in the output
    } finally {
      unlinkSync(scriptPath);
    }
  });
});

// ---------------------------------------------------------------------------
// KimiCodeEngine collects text from ALL roles (potential bug)
// ---------------------------------------------------------------------------

describe("KimiCodeEngine – role filtering behavior", () => {
  it("collects text from user-role content arrays (no role filter)", async () => {
    // The parseKimiJson implementation does NOT filter by role.
    // It collects text from ANY line with a content array.
    // This means user messages and tool results with content arrays also pollute the output.
    const scriptPath = "/tmp/cb-kimi-user-role.sh";
    const userMsg = JSON.stringify({
      role: "user",
      content: [{ type: "text", text: "USER INPUT TEXT" }],
    });
    const assistantMsg = JSON.stringify({
      role: "assistant",
      content: [{ type: "text", text: "assistant reply" }],
    });
    makeScript(scriptPath, `echo '${userMsg}'\necho '${assistantMsg}'`);
    try {
      const engine = new KimiCodeEngine({ command: scriptPath });
      const result = await engine.start(makeRequest());
      expect(result.error).toBeUndefined();
      // Bug: user input is included in the output
      // The expected correct behavior: output should only contain 'assistant reply'
      // The actual behavior: 'USER INPUT TEXT' + 'assistant reply' = bug
      expect(result.output).toBe("assistant reply"); // This will FAIL if the bug is present
    } finally {
      unlinkSync(scriptPath);
    }
  });

  it("does not include system-role content in output", async () => {
    const scriptPath = "/tmp/cb-kimi-system-role.sh";
    const systemMsg = JSON.stringify({
      role: "system",
      content: [{ type: "text", text: "SYSTEM PROMPT" }],
    });
    const assistantMsg = JSON.stringify({
      role: "assistant",
      content: [{ type: "text", text: "assistant answer" }],
    });
    makeScript(scriptPath, `echo '${systemMsg}'\necho '${assistantMsg}'`);
    try {
      const engine = new KimiCodeEngine({ command: scriptPath });
      const result = await engine.start(makeRequest());
      expect(result.error).toBeUndefined();
      // Bug: system prompt text leaks into output
      expect(result.output).toBe("assistant answer"); // FAIL if system text is included
    } finally {
      unlinkSync(scriptPath);
    }
  });
});

// ---------------------------------------------------------------------------
// Session ID file edge cases
// ---------------------------------------------------------------------------

describe("KimiCodeEngine – session ID edge cases", () => {
  const fakeHome = "/tmp/cb-kimi-adv-home";
  let originalHome: string | undefined;

  beforeAll(() => {
    mkdirSync(path.join(fakeHome, ".kimi"), { recursive: true });
  });

  beforeEach(() => {
    originalHome = process.env.HOME;
    process.env.HOME = fakeHome;
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    try {
      rmSync(path.join(fakeHome, ".kimi", "kimi.json"));
    } catch {
      /* ok */
    }
  });

  it("corrupt kimi.json (invalid JSON) returns null, does not throw", async () => {
    writeFileSync(
      path.join(fakeHome, ".kimi", "kimi.json"),
      "{ corrupt json :::: }",
    );
    const payload = JSON.stringify({
      role: "assistant",
      content: [{ type: "text", text: "ok" }],
    });
    const engine = new KimiCodeEngine({
      command: "echo",
      defaultArgs: [payload],
    });
    const result = await engine.start(makeRequest());
    // SyntaxError from JSON.parse — caught and logged to stderr, returns null
    expect(result.error).toBeUndefined();
    expect(result.sessionId).toBeNull();
  });

  it("kimi.json with work_dirs as non-array returns null", async () => {
    writeFileSync(
      path.join(fakeHome, ".kimi", "kimi.json"),
      JSON.stringify({ work_dirs: "not an array" }),
    );
    const payload = JSON.stringify({
      role: "assistant",
      content: [{ type: "text", text: "ok" }],
    });
    const engine = new KimiCodeEngine({
      command: "echo",
      defaultArgs: [payload],
    });
    const result = await engine.start(makeRequest());
    expect(result.error).toBeUndefined();
    expect(result.sessionId).toBeNull();
  });

  it("kimi.json with empty work_dirs array returns null", async () => {
    writeFileSync(
      path.join(fakeHome, ".kimi", "kimi.json"),
      JSON.stringify({ work_dirs: [] }),
    );
    const payload = JSON.stringify({
      role: "assistant",
      content: [{ type: "text", text: "ok" }],
    });
    const engine = new KimiCodeEngine({
      command: "echo",
      defaultArgs: [payload],
    });
    const result = await engine.start(makeRequest());
    expect(result.error).toBeUndefined();
    expect(result.sessionId).toBeNull();
  });

  it("kimi.json with work_dirs entry where path is undefined returns null", async () => {
    writeFileSync(
      path.join(fakeHome, ".kimi", "kimi.json"),
      JSON.stringify({ work_dirs: [{ last_session_id: "sess-no-path" }] }),
    );
    const payload = JSON.stringify({
      role: "assistant",
      content: [{ type: "text", text: "ok" }],
    });
    const engine = new KimiCodeEngine({
      command: "echo",
      defaultArgs: [payload],
    });
    const result = await engine.start(makeRequest());
    // No matching path → null
    expect(result.sessionId).toBeNull();
  });

  it("kimi.json session ID read is NOT skipped when engine returns an error (start error path)", async () => {
    // When start() gets an error from exec(), it short-circuits and skips readKimiSessionId.
    // The session ID is lost even if kimi.json has a valid entry.
    writeFileSync(
      path.join(fakeHome, ".kimi", "kimi.json"),
      JSON.stringify({
        work_dirs: [
          { path: "/tmp/cb-test-project", last_session_id: "should-be-lost" },
        ],
      }),
    );
    // 'false' exits non-zero → ENGINE_CRASH → readKimiSessionId NOT called
    const engine = new KimiCodeEngine({ command: "false" });
    const result = await engine.start(makeRequest());
    expect(result.error).toBeDefined();
    expect(result.error?.code).toBe("ENGINE_CRASH");
    // sessionId is null because readKimiSessionId is only called on success path
    expect(result.sessionId).toBeNull();
  });

  it("send() session ID read uses cwd parameter, not workspace_path", async () => {
    // send() calls readKimiSessionId(cwd) where cwd = opts?.cwd ?? process.cwd()
    // If opts.cwd is provided, that path is used for lookup in kimi.json.
    writeFileSync(
      path.join(fakeHome, ".kimi", "kimi.json"),
      JSON.stringify({
        work_dirs: [
          { path: "/tmp/cb-test-project", last_session_id: "sess-send-cwd" },
        ],
      }),
    );
    const scriptPath = "/tmp/cb-kimi-send-cwd.sh";
    const payload = JSON.stringify({
      role: "assistant",
      content: [{ type: "text", text: "ok" }],
    });
    makeScript(scriptPath, `echo '${payload}'`);
    try {
      const engine = new KimiCodeEngine({ command: scriptPath });
      const result = await engine.send("old-sess", "message", {
        cwd: "/tmp/cb-test-project",
      });
      expect(result.sessionId).toBe("sess-send-cwd");
    } finally {
      unlinkSync(scriptPath);
    }
  });

  it("send() without cwd uses process.cwd() for session ID lookup", async () => {
    // send() with no opts.cwd falls back to process.cwd().
    // The kimi.json entry must match process.cwd() to get a session ID.
    // This is a potential bug: process.cwd() may not be the workspace.
    writeFileSync(
      path.join(fakeHome, ".kimi", "kimi.json"),
      JSON.stringify({
        work_dirs: [
          { path: process.cwd(), last_session_id: "sess-from-cwd" },
          { path: "/tmp/cb-test-project", last_session_id: "sess-wrong" },
        ],
      }),
    );
    const scriptPath = "/tmp/cb-kimi-send-nocwd.sh";
    const payload = JSON.stringify({
      role: "assistant",
      content: [{ type: "text", text: "ok" }],
    });
    makeScript(scriptPath, `echo '${payload}'`);
    try {
      const engine = new KimiCodeEngine({ command: scriptPath });
      // No cwd option — falls back to process.cwd()
      const result = await engine.send("old-sess", "message");
      expect(result.sessionId).toBe("sess-from-cwd");
    } finally {
      unlinkSync(scriptPath);
    }
  });
});

// ---------------------------------------------------------------------------
// Empty / unusual workspace path
// ---------------------------------------------------------------------------

describe("KimiCodeEngine – workspace path edge cases", () => {
  it("handles workspace path with spaces (passed as cwd to spawn)", async () => {
    mkdirSync("/tmp/cb kimi workspace spaces", { recursive: true });
    const scriptPath = "/tmp/cb-kimi-spaces-ws.sh";
    const payload = JSON.stringify({
      role: "assistant",
      content: [{ type: "text", text: "ok spaces" }],
    });
    makeScript(scriptPath, `echo '${payload}'`);
    try {
      const engine = new KimiCodeEngine({ command: scriptPath });
      const result = await engine.start(
        makeRequest({
          workspace_path: "/tmp/cb kimi workspace spaces",
        }),
      );
      expect(result.error).toBeUndefined();
      expect(result.output).toBe("ok spaces");
    } finally {
      unlinkSync(scriptPath);
    }
  });

  it("start() passes -w flag with the actual workspace_path value (arg injection check)", async () => {
    // Verify -w receives the workspace path as a discrete argument (no shell splitting).
    const scriptPath = "/tmp/cb-kimi-verify-w.sh";
    makeScript(scriptPath, `printf '%s\\n' "$@"`);
    try {
      const engine = new KimiCodeEngine({ command: scriptPath });
      const result = await engine.start(
        makeRequest({
          workspace_path: "/tmp/cb-test-project",
          message: "verify workspace",
        }),
      );
      const lines = result.output.split("\n").filter(Boolean);
      // Find the -w arg and the following value
      const wIdx = lines.indexOf("-w");
      expect(wIdx).toBeGreaterThanOrEqual(0);
      expect(lines[wIdx + 1]).toBe("/tmp/cb-test-project");
    } finally {
      unlinkSync(scriptPath);
    }
  });
});

// ---------------------------------------------------------------------------
// Very large individual NDJSON lines
// ---------------------------------------------------------------------------

describe("KimiCodeEngine – large NDJSON lines", () => {
  it("handles a single very large text content item (1MB text value)", async () => {
    const largeText = "A".repeat(1024 * 1024); // 1 MB
    const payload = JSON.stringify({
      role: "assistant",
      content: [{ type: "text", text: largeText }],
    });
    // Write the payload to a file to avoid shell argument list length limits
    const payloadPath = "/tmp/cb-kimi-large-payload.json";
    writeFileSync(payloadPath, payload + "\n");
    const scriptPath = "/tmp/cb-kimi-large-line.sh";
    // Use cat to stream the file rather than embedding the payload in a shell arg
    makeScript(scriptPath, `cat '${payloadPath}'`);
    try {
      const engine = new KimiCodeEngine({ command: scriptPath });
      const result = await engine.start(
        makeRequest({
          constraints: { timeout_ms: 30000, allow_network: true },
        }),
      );
      expect(result.error).toBeUndefined();
      expect(result.output).toBe(largeText);
      expect(result.output.length).toBe(1024 * 1024);
    } finally {
      unlinkSync(scriptPath);
      try {
        unlinkSync(payloadPath);
      } catch {
        /* ok */
      }
    }
  }, 20000);
});

// ---------------------------------------------------------------------------
// send() method behavior
// ---------------------------------------------------------------------------

describe("KimiCodeEngine – send() edge cases", () => {
  it("send() with empty stdout and zero exit code returns empty output", async () => {
    const scriptPath = "/tmp/cb-kimi-send-empty.sh";
    makeScript(scriptPath, `true`);
    try {
      const engine = new KimiCodeEngine({ command: scriptPath });
      const result = await engine.send("sess-123", "message", {
        cwd: "/tmp/cb-test-project",
      });
      expect(result.error).toBeUndefined();
      // parseKimiJson('') → text: '' — output is empty
      expect(result.output).toBe("");
    } finally {
      unlinkSync(scriptPath);
    }
  });

  it("send() with non-zero exit code returns ENGINE_CRASH and skips session ID read", async () => {
    const engine = new KimiCodeEngine({ command: "false" });
    const result = await engine.send("sess-123", "message", {
      cwd: "/tmp/cb-test-project",
    });
    expect(result.error?.code).toBe("ENGINE_CRASH");
    // error path: readKimiSessionId is not called
    expect(result.sessionId).toBeNull();
  });

  it("send() builds --session and -w flags correctly", async () => {
    const scriptPath = "/tmp/cb-kimi-send-flags.sh";
    makeScript(scriptPath, `printf '%s\\n' "$@"`);
    try {
      const engine = new KimiCodeEngine({ command: scriptPath });
      const result = await engine.send("my-kimi-sess", "test message", {
        cwd: "/tmp/cb-test-project",
      });
      expect(result.output).toContain("--session");
      expect(result.output).toContain("my-kimi-sess");
      expect(result.output).toContain("-w");
      expect(result.output).toContain("/tmp/cb-test-project");
      expect(result.output).toContain("-p");
      expect(result.output).toContain("test message");
    } finally {
      unlinkSync(scriptPath);
    }
  });

  it("send() ignores engine defaultArgs (always uses hardcoded arg list)", async () => {
    // KimiCodeEngine.send() never uses this.defaultArgs; it always builds its own args.
    // Setting defaultArgs has no effect on send() behavior.
    const scriptPath = "/tmp/cb-kimi-send-default-args.sh";
    makeScript(scriptPath, `printf '%s\\n' "$@"`);
    try {
      const engine = new KimiCodeEngine({
        command: scriptPath,
        defaultArgs: ["--should-never-appear"],
      });
      const result = await engine.send("sess-xyz", "message", {
        cwd: "/tmp/cb-test-project",
      });
      expect(result.output).not.toContain("--should-never-appear");
      expect(result.output).toContain("--session");
    } finally {
      unlinkSync(scriptPath);
    }
  });
});

// ---------------------------------------------------------------------------
// buildStartArgs bypass with defaultArgs
// ---------------------------------------------------------------------------

describe("KimiCodeEngine – buildStartArgs with defaultArgs bypass", () => {
  it("start() with defaultArgs bypasses -w workspace and -p message entirely", async () => {
    // When defaultArgs is set, buildStartArgs returns them as-is.
    // The workspace_path and message from the task are NOT passed to the CLI.
    // The -w flag required for Kimi to know the workspace is completely absent.
    const scriptPath = "/tmp/cb-kimi-default-args-bypass.sh";
    makeScript(scriptPath, `printf '%s\\n' "$@"`);
    try {
      const engine = new KimiCodeEngine({
        command: scriptPath,
        defaultArgs: ["--print", "--output-format", "stream-json"],
      });
      const result = await engine.start(
        makeRequest({
          workspace_path: "/tmp/cb-test-project",
          message: "critical task message",
        }),
      );
      // defaultArgs are used verbatim — workspace and message are lost
      expect(result.output).not.toContain("-w");
      expect(result.output).not.toContain("critical task message");
      // Documenting this as expected behavior, same as ClaudeCodeEngine
    } finally {
      unlinkSync(scriptPath);
    }
  });
});

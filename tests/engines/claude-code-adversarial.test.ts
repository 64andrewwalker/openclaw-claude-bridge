/**
 * Adversarial tests for ClaudeCodeEngine.
 *
 * These tests probe edge cases and failure modes not covered by the existing suite.
 * They are intentionally written to surface bugs. Do NOT modify production code.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { mkdirSync, writeFileSync, unlinkSync, chmodSync } from "node:fs";
import { ClaudeCodeEngine } from "../../src/engines/claude-code.js";
import type { TaskRequest } from "../../src/schemas/request.js";

const makeRequest = (overrides?: Partial<TaskRequest>): TaskRequest => ({
  task_id: "task-adv-001",
  intent: "coding",
  workspace_path: "/tmp/cb-test-project",
  message: "Hello world",
  engine: "claude-code",
  mode: "new",
  session_id: null,
  constraints: { timeout_ms: 15000, allow_network: true },
  ...overrides,
});

beforeAll(() => {
  mkdirSync("/tmp/cb-test-project", { recursive: true });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeScript(scriptPath: string, body: string): void {
  writeFileSync(scriptPath, `#!/bin/sh\n${body}\n`);
  chmodSync(scriptPath, 0o755);
}

// ---------------------------------------------------------------------------
// Malformed / partial JSON output
// ---------------------------------------------------------------------------

describe("ClaudeCodeEngine – malformed / partial JSON", () => {
  it("returns raw stdout as output when JSON is completely malformed", async () => {
    // Completely unrecoverable garbage — no line starts with { or [
    const engine = new ClaudeCodeEngine({
      command: "echo",
      defaultArgs: ["this is not json at all"],
    });
    const result = await engine.start(makeRequest());
    // parseClaudeJson returns null; output should fall back to stdout.trim()
    expect(result.error).toBeUndefined();
    expect(result.output).toBe("this is not json at all");
    expect(result.sessionId).toBeNull();
    expect(result.tokenUsage).toBeNull();
  });

  it("handles partial JSON cut off mid-object (stream truncation)", async () => {
    // Simulates a stream that died mid-JSON — "{\"result\":\"abc" (no closing brace)
    const scriptPath = "/tmp/cb-partial-json.sh";
    makeScript(scriptPath, `printf '{"result":"truncated text'`);
    try {
      const engine = new ClaudeCodeEngine({ command: scriptPath });
      const result = await engine.start(makeRequest());
      // Should not throw — should return something rather than crash
      expect(result.error).toBeUndefined();
      // Output falls back to raw stdout since JSON.parse fails
      expect(typeof result.output).toBe("string");
    } finally {
      unlinkSync(scriptPath);
    }
  });

  it("handles JSON where result field is null (not a string)", async () => {
    // {"result":null,"session_id":"sid"} — result is null, not string
    const payload = JSON.stringify({
      result: null,
      session_id: "sid-null-result",
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const engine = new ClaudeCodeEngine({
      command: "echo",
      defaultArgs: [payload],
    });
    const result = await engine.start(makeRequest());
    expect(result.error).toBeUndefined();
    // When result is not a string, output should fall back to stdout.trim()
    expect(result.output).toBe(payload.trim());
    // session_id should still be extracted from the parsed JSON
    expect(result.sessionId).toBe("sid-null-result");
  });

  it("handles JSON where result field is a number (not a string)", async () => {
    const payload = JSON.stringify({
      result: 42,
      session_id: "sid-num",
      usage: { input_tokens: 5, output_tokens: 2 },
    });
    const engine = new ClaudeCodeEngine({
      command: "echo",
      defaultArgs: [payload],
    });
    const result = await engine.start(makeRequest());
    expect(result.error).toBeUndefined();
    // result is a number, not a string — falls back to stdout.trim()
    expect(result.output).toBe(payload.trim());
    expect(result.sessionId).toBe("sid-num");
  });

  it("handles empty stdout (zero output, zero exit code)", async () => {
    // `true` exits 0 with no output
    const engine = new ClaudeCodeEngine({ command: "true" });
    const result = await engine.start(makeRequest());
    // Zero exit code with zero output — parseOutput is called with empty string
    // parseClaudeJson("") returns null, so output becomes "".trim() = ""
    expect(result.error).toBeUndefined();
    expect(result.output).toBe("");
    expect(result.sessionId).toBeNull();
    expect(result.tokenUsage).toBeNull();
  });

  it("handles JSON array as top-level output (not an object)", async () => {
    // JSON array rather than object — some CLIs might output this
    const payload = '[{"result":"array-item","session_id":"sid-arr"}]';
    const engine = new ClaudeCodeEngine({
      command: "echo",
      defaultArgs: [payload],
    });
    const result = await engine.start(makeRequest());
    expect(result.error).toBeUndefined();
    // The array was parsed but has no .result or .session_id at top level
    // extractSessionId falls back to regex search: finds "session_id":"sid-arr" in raw
    expect(result.sessionId).toBe("sid-arr");
  });

  it("only stderr output (stdout empty), zero exit code", async () => {
    const scriptPath = "/tmp/cb-stderr-only.sh";
    makeScript(scriptPath, `echo 'only on stderr' >&2`);
    try {
      const engine = new ClaudeCodeEngine({ command: scriptPath });
      const result = await engine.start(makeRequest());
      expect(result.error).toBeUndefined();
      expect(result.output).toBe("");
      expect(result.sessionId).toBeNull();
    } finally {
      unlinkSync(scriptPath);
    }
  });

  it("non-zero exit code with valid JSON on stdout — JSON is IGNORED", async () => {
    // When exit code != 0, BaseEngine short-circuits before calling parseOutput.
    // The valid JSON payload is never parsed — engine returns error, not JSON content.
    const scriptPath = "/tmp/cb-nonzero-valid-json.sh";
    const payload = JSON.stringify({
      result: "should not be used",
      session_id: "sess-lost",
    });
    makeScript(scriptPath, `printf '${payload}'\nexit 1`);
    try {
      const engine = new ClaudeCodeEngine({ command: scriptPath });
      const result = await engine.start(makeRequest());
      expect(result.error).toBeDefined();
      expect(result.error?.code).toBe("ENGINE_CRASH");
      // Key behavioral invariant: session_id from valid JSON in stdout is NOT extracted
      // when exit code is non-zero — it's lost because parseOutput is never called.
      expect(result.sessionId).toBeNull();
    } finally {
      unlinkSync(scriptPath);
    }
  });
});

// ---------------------------------------------------------------------------
// session_id extraction edge cases
// ---------------------------------------------------------------------------

describe("ClaudeCodeEngine – session_id extraction", () => {
  it("extracts session_id from parsed JSON field (normal case)", async () => {
    const payload = JSON.stringify({ result: "ok", session_id: "sess-normal" });
    const engine = new ClaudeCodeEngine({
      command: "echo",
      defaultArgs: [payload],
    });
    const result = await engine.start(makeRequest());
    expect(result.sessionId).toBe("sess-normal");
  });

  it("falls back to regex when session_id is not top-level but buried in output", async () => {
    // Log prefix before the JSON — JSON has no session_id at top level
    // but session_id appears somewhere in the combined text
    const scriptPath = "/tmp/cb-session-regex.sh";
    // JSON has no session_id field, but stderr/stdout raw contains it
    makeScript(
      scriptPath,
      `printf 'INFO: session started\n{"result":"done"}\nDEBUG "session_id": "found-in-raw"\n'`,
    );
    try {
      const engine = new ClaudeCodeEngine({ command: scriptPath });
      const result = await engine.start(makeRequest());
      expect(result.error).toBeUndefined();
      // The regex scans stderr+stdout combined — should find it
      expect(result.sessionId).toBe("found-in-raw");
    } finally {
      unlinkSync(scriptPath);
    }
  });

  it("session_id is null in JSON (null value, not absent)", async () => {
    // session_id field exists but is JSON null — typeof null !== 'string'
    const payload = JSON.stringify({ result: "ok", session_id: null });
    const engine = new ClaudeCodeEngine({
      command: "echo",
      defaultArgs: [payload],
    });
    const result = await engine.start(makeRequest());
    expect(result.error).toBeUndefined();
    // typeof null !== 'string' so falls to regex, finds nothing
    expect(result.sessionId).toBeNull();
  });

  it("session_id is numeric in JSON (wrong type)", async () => {
    const payload = JSON.stringify({ result: "ok", session_id: 12345 });
    const engine = new ClaudeCodeEngine({
      command: "echo",
      defaultArgs: [payload],
    });
    const result = await engine.start(makeRequest());
    expect(result.error).toBeUndefined();
    // typeof 12345 !== 'string' → falls to regex; "12345" is not quoted-string so no match
    expect(result.sessionId).toBeNull();
  });

  it("regex finds session_id when it has extra whitespace around colon", async () => {
    // Claude may emit {"session_id" : "spaced-123"} — the regex has \s*:\s*
    const scriptPath = "/tmp/cb-session-spaced.sh";
    makeScript(
      scriptPath,
      `printf '{"result":"ok","session_id" : "spaced-123"}'`,
    );
    try {
      const engine = new ClaudeCodeEngine({ command: scriptPath });
      const result = await engine.start(makeRequest());
      expect(result.sessionId).toBe("spaced-123");
    } finally {
      unlinkSync(scriptPath);
    }
  });

  it("session_id with special characters (UUID with hyphens)", async () => {
    const sid = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    const payload = JSON.stringify({ result: "ok", session_id: sid });
    const engine = new ClaudeCodeEngine({
      command: "echo",
      defaultArgs: [payload],
    });
    const result = await engine.start(makeRequest());
    expect(result.sessionId).toBe(sid);
  });
});

// ---------------------------------------------------------------------------
// token_usage edge cases
// ---------------------------------------------------------------------------

describe("ClaudeCodeEngine – token_usage edge cases", () => {
  it("returns null tokenUsage when usage field is absent", async () => {
    const payload = JSON.stringify({ result: "ok", session_id: "sid" });
    const engine = new ClaudeCodeEngine({
      command: "echo",
      defaultArgs: [payload],
    });
    const result = await engine.start(makeRequest());
    expect(result.tokenUsage).toBeNull();
  });

  it("returns null tokenUsage when input_tokens is missing", async () => {
    const payload = JSON.stringify({
      result: "ok",
      usage: { output_tokens: 5 },
    });
    const engine = new ClaudeCodeEngine({
      command: "echo",
      defaultArgs: [payload],
    });
    const result = await engine.start(makeRequest());
    expect(result.tokenUsage).toBeNull();
  });

  it("returns null tokenUsage when output_tokens is missing", async () => {
    const payload = JSON.stringify({
      result: "ok",
      usage: { input_tokens: 10 },
    });
    const engine = new ClaudeCodeEngine({
      command: "echo",
      defaultArgs: [payload],
    });
    const result = await engine.start(makeRequest());
    expect(result.tokenUsage).toBeNull();
  });

  it("returns null tokenUsage when input_tokens is null", async () => {
    const payload = JSON.stringify({
      result: "ok",
      usage: { input_tokens: null, output_tokens: 5 },
    });
    const engine = new ClaudeCodeEngine({
      command: "echo",
      defaultArgs: [payload],
    });
    const result = await engine.start(makeRequest());
    expect(result.tokenUsage).toBeNull();
  });

  it("returns null tokenUsage when tokens are strings not numbers", async () => {
    const payload = JSON.stringify({
      result: "ok",
      usage: { input_tokens: "10", output_tokens: "5" },
    });
    const engine = new ClaudeCodeEngine({
      command: "echo",
      defaultArgs: [payload],
    });
    const result = await engine.start(makeRequest());
    expect(result.tokenUsage).toBeNull();
  });

  it("rejects negative token counts — tokenUsage is null for negative values", async () => {
    // Negative token counts are invalid and rejected by the engine.
    const payload = JSON.stringify({
      result: "ok",
      usage: { input_tokens: -5, output_tokens: -3 },
    });
    const engine = new ClaudeCodeEngine({
      command: "echo",
      defaultArgs: [payload],
    });
    const result = await engine.start(makeRequest());
    // Negative tokens are rejected — tokenUsage must be null
    expect(result.tokenUsage).toBeNull();
  });

  it("ignores existing total_tokens in JSON and recalculates from parts", async () => {
    // If the CLI provides total_tokens = 100 but input=10 + output=5,
    // the engine ignores the provided total and returns 15.
    // This test documents whether the recalculation matches the provided value.
    const payload = JSON.stringify({
      result: "ok",
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 100 },
    });
    const engine = new ClaudeCodeEngine({
      command: "echo",
      defaultArgs: [payload],
    });
    const result = await engine.start(makeRequest());
    expect(result.tokenUsage).not.toBeNull();
    // The engine recomputes: 10 + 5 = 15, ignoring the 100 in the JSON.
    // If the Claude CLI's total_tokens differs from input+output, this will be wrong.
    expect(result.tokenUsage!.total_tokens).toBe(15);
    // Document: the provided total_tokens (100) from the CLI is silently discarded
    expect(result.tokenUsage!.total_tokens).not.toBe(100);
  });

  it("token_usage has zero values (edge: valid zero counts)", async () => {
    const payload = JSON.stringify({
      result: "ok",
      usage: { input_tokens: 0, output_tokens: 0 },
    });
    const engine = new ClaudeCodeEngine({
      command: "echo",
      defaultArgs: [payload],
    });
    const result = await engine.start(makeRequest());
    expect(result.tokenUsage).toEqual({
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// Special characters in workspace path or message
// ---------------------------------------------------------------------------

describe("ClaudeCodeEngine – special characters", () => {
  it("handles workspace path with spaces", async () => {
    mkdirSync("/tmp/cb test project with spaces", { recursive: true });
    const scriptPath = "/tmp/cb-workspace-spaces.sh";
    makeScript(scriptPath, `printf '%s\\n' "$@"`);
    try {
      const engine = new ClaudeCodeEngine({ command: scriptPath });
      const result = await engine.start(
        makeRequest({
          workspace_path: "/tmp/cb test project with spaces",
        }),
      );
      // Engine should pass workspace as cwd — script gets its own args, not cwd
      // The cwd is set on the spawn options; no error expected
      expect(result.error).toBeUndefined();
    } finally {
      unlinkSync(scriptPath);
    }
  });

  it("handles message with single quotes and shell metacharacters", async () => {
    // Message is passed as a CLI -p argument — shell injection should not occur
    // since args are passed as an array (no shell interpolation)
    const dangerousMessage = `'; rm -rf /tmp/evil; echo 'done`;
    const payload = JSON.stringify({ result: "safe", session_id: "sid-safe" });
    const engine = new ClaudeCodeEngine({
      command: "echo",
      defaultArgs: [payload],
    });
    const result = await engine.start(
      makeRequest({ message: dangerousMessage }),
    );
    // defaultArgs are used (not the message), so this is mainly a smoke test
    expect(result.error).toBeUndefined();
    expect(result.output).toBe("safe");
  });

  it("handles message with newlines passed to -p argument", async () => {
    // Newlines in the message arg — should be passed as a single arg, not split
    const scriptPath = "/tmp/cb-msg-newline.sh";
    makeScript(scriptPath, `printf '{"result":"ok","session_id":"sid-nl"}'`);
    try {
      const engine = new ClaudeCodeEngine({ command: scriptPath });
      const result = await engine.start(
        makeRequest({
          message: "line one\nline two\nline three",
        }),
      );
      expect(result.error).toBeUndefined();
      expect(result.output).toBe("ok");
    } finally {
      unlinkSync(scriptPath);
    }
  });
});

// ---------------------------------------------------------------------------
// parseClaudeJson: line-scanning logic edge cases
// ---------------------------------------------------------------------------

describe("ClaudeCodeEngine – parseClaudeJson line scanning", () => {
  it("picks the LAST valid JSON line when multiple JSON objects are present (NDJSON)", async () => {
    // The reverse-scan logic picks the last valid JSON line.
    // This means in NDJSON output, the LAST JSON wins — not necessarily the "final_reply" one.
    const scriptPath = "/tmp/cb-multi-json-lines.sh";
    const line1 = JSON.stringify({ result: "first", session_id: "sid-first" });
    const line2 = JSON.stringify({
      result: "second",
      session_id: "sid-second",
    });
    makeScript(scriptPath, `printf '${line1}\\n${line2}\\n'`);
    try {
      const engine = new ClaudeCodeEngine({ command: scriptPath });
      const result = await engine.start(makeRequest());
      expect(result.error).toBeUndefined();
      // Reverse scan finds last valid JSON: line2
      expect(result.output).toBe("second");
      expect(result.sessionId).toBe("sid-second");
    } finally {
      unlinkSync(scriptPath);
    }
  });

  it("skips invalid JSON lines and finds the last valid one", async () => {
    const scriptPath = "/tmp/cb-mixed-lines.sh";
    const validJson = JSON.stringify({
      result: "valid",
      session_id: "sid-valid",
    });
    // Last line is broken JSON (starts with { but is invalid), second-to-last is valid
    makeScript(
      scriptPath,
      `printf 'INFO: log line\\n${validJson}\\n{"broken json'`,
    );
    try {
      const engine = new ClaudeCodeEngine({ command: scriptPath });
      const result = await engine.start(makeRequest());
      expect(result.error).toBeUndefined();
      // Reverse scan: last line is '{broken...' (invalid, skipped), then finds validJson
      expect(result.output).toBe("valid");
      expect(result.sessionId).toBe("sid-valid");
    } finally {
      unlinkSync(scriptPath);
    }
  });

  it("handles output with ONLY a trailing newline after valid JSON", async () => {
    const scriptPath = "/tmp/cb-trailing-newline.sh";
    const payload = JSON.stringify({
      result: "newline-trailing",
      session_id: "sid-nt",
    });
    // printf with trailing newline (same as echo)
    makeScript(scriptPath, `printf '${payload}\\n'`);
    try {
      const engine = new ClaudeCodeEngine({ command: scriptPath });
      const result = await engine.start(makeRequest());
      expect(result.output).toBe("newline-trailing");
      expect(result.sessionId).toBe("sid-nt");
    } finally {
      unlinkSync(scriptPath);
    }
  });

  it("handles output that is only whitespace", async () => {
    const scriptPath = "/tmp/cb-whitespace-only.sh";
    makeScript(scriptPath, `printf '   \\n\\t\\n   '`);
    try {
      const engine = new ClaudeCodeEngine({ command: scriptPath });
      const result = await engine.start(makeRequest());
      // trimmed is empty → parseClaudeJson returns null → output is ""
      expect(result.error).toBeUndefined();
      expect(result.output).toBe("");
    } finally {
      unlinkSync(scriptPath);
    }
  });
});

// ---------------------------------------------------------------------------
// send() method
// ---------------------------------------------------------------------------

describe("ClaudeCodeEngine – send()", () => {
  it("send() uses --resume flag with the provided session ID", async () => {
    const scriptPath = "/tmp/cb-claude-send-args.sh";
    makeScript(scriptPath, `printf '%s\\n' "$@"`);
    try {
      const engine = new ClaudeCodeEngine({ command: scriptPath });
      const result = await engine.send("my-session-id", "follow up message", {
        cwd: "/tmp/cb-test-project",
      });
      expect(result.output).toContain("--resume");
      expect(result.output).toContain("my-session-id");
      expect(result.output).toContain("--print");
      expect(result.output).toContain("-p");
      expect(result.output).toContain("follow up message");
    } finally {
      unlinkSync(scriptPath);
    }
  });

  it("send() parses JSON output correctly", async () => {
    const payload = JSON.stringify({
      result: "send-result",
      session_id: "sess-send",
      usage: { input_tokens: 3, output_tokens: 7 },
    });
    const scriptPath = "/tmp/cb-send-parse.sh";
    makeScript(scriptPath, `echo '${payload}'`);
    try {
      const engine = new ClaudeCodeEngine({ command: scriptPath });
      const result = await engine.send("sess-old", "message", {
        cwd: "/tmp/cb-test-project",
      });
      expect(result.output).toBe("send-result");
      expect(result.sessionId).toBe("sess-send");
      expect(result.tokenUsage?.total_tokens).toBe(10);
    } finally {
      unlinkSync(scriptPath);
    }
  });

  it("send() with empty session ID still builds args (edge: empty string session)", async () => {
    const scriptPath = "/tmp/cb-send-empty-sess.sh";
    makeScript(scriptPath, `printf '%s\\n' "$@"`);
    try {
      const engine = new ClaudeCodeEngine({ command: scriptPath });
      const result = await engine.send("", "message", {
        cwd: "/tmp/cb-test-project",
      });
      // Empty session ID is passed to --resume — this may or may not be valid
      // but should not crash the engine itself
      expect(result.error).toBeUndefined();
      expect(result.output).toContain("--resume");
    } finally {
      unlinkSync(scriptPath);
    }
  });
});

// ---------------------------------------------------------------------------
// Output cap boundary tests
// ---------------------------------------------------------------------------

describe("ClaudeCodeEngine – output cap boundary", () => {
  it("accepts output at exactly the cap boundary (10MB)", async () => {
    const bytes = 10 * 1024 * 1024; // exactly 10MB
    const engine = new ClaudeCodeEngine({
      command: "node",
      defaultArgs: ["-e", `process.stdout.write('x'.repeat(${bytes}))`],
    });
    const result = await engine.start(
      makeRequest({ constraints: { timeout_ms: 30000, allow_network: true } }),
    );
    // Exactly at cap: remaining == 0 after last byte, so outputOverflow is NOT set
    // The engine should succeed (no error), not overflow
    expect(result.error?.code).not.toBe("ENGINE_CRASH");
  }, 20000);

  it("caps output at 1 byte OVER the cap boundary", async () => {
    const bytes = 10 * 1024 * 1024 + 1; // 1 byte over
    const engine = new ClaudeCodeEngine({
      command: "node",
      defaultArgs: ["-e", `process.stdout.write('x'.repeat(${bytes}))`],
    });
    const result = await engine.start(
      makeRequest({ constraints: { timeout_ms: 30000, allow_network: true } }),
    );
    expect(result.error?.code).toBe("ENGINE_CRASH");
    expect(result.error?.message).toContain("exceeded");
  }, 20000);
});

/**
 * Adversarial tests for CodexEngine — probing edge cases and potential bugs.
 * These tests only ADD coverage; they do not modify any existing test or production code.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { mkdirSync, writeFileSync, unlinkSync, chmodSync } from "node:fs";
import { CodexEngine } from "../../src/engines/codex.js";
import type { TaskRequest } from "../../src/schemas/request.js";

describe("CodexEngine — adversarial", () => {
  beforeAll(() => {
    mkdirSync("/tmp/cb-test-project", { recursive: true });
  });

  const makeRequest = (overrides?: Partial<TaskRequest>): TaskRequest => ({
    task_id: "task-adv-001",
    intent: "coding",
    workspace_path: "/tmp/cb-test-project",
    message: "Hello world",
    engine: "codex",
    mode: "new",
    session_id: null,
    constraints: { timeout_ms: 30000, allow_network: true },
    ...overrides,
  });

  // -----------------------------------------------------------------------
  // thread_id extraction edge cases
  // -----------------------------------------------------------------------

  it("thread.started with thread_id as number (wrong type) should NOT capture numeric thread_id as sessionId", async () => {
    // thread_id is a number, not a string — the type guard `typeof event.thread_id === 'string'`
    // should skip it. The fallback to thread.id is guarded by `!sessionId`, which is still null,
    // so it should check thread.id too. If there's no thread.id either, sessionId stays null.
    const scriptPath = "/tmp/cb-adv-codex-thread-number.sh";
    writeFileSync(
      scriptPath,
      [
        "#!/bin/sh",
        'echo \'{"type":"thread.started","thread_id":42}\'',
        'echo \'{"type":"item.completed","item":{"type":"agent_message","text":"done"}}\'',
      ].join("\n"),
    );
    chmodSync(scriptPath, 0o755);
    try {
      const engine = new CodexEngine({ command: scriptPath });
      const result = await engine.start(makeRequest());
      // thread_id is not a string, so sessionId should remain null
      expect(result.sessionId).toBeNull();
      expect(result.output).toBe("done");
    } finally {
      unlinkSync(scriptPath);
    }
  });

  it("thread.started with both thread_id (string) and thread.id — thread_id wins", async () => {
    // When thread_id is a valid string, sessionId is set. The thread.id fallback
    // only fires when !sessionId, so thread.id should be ignored.
    const scriptPath = "/tmp/cb-adv-codex-thread-both.sh";
    writeFileSync(
      scriptPath,
      [
        "#!/bin/sh",
        'echo \'{"type":"thread.started","thread_id":"primary-id","thread":{"id":"secondary-id"}}\'',
      ].join("\n"),
    );
    chmodSync(scriptPath, 0o755);
    try {
      const engine = new CodexEngine({ command: scriptPath });
      const result = await engine.start(makeRequest());
      expect(result.sessionId).toBe("primary-id");
    } finally {
      unlinkSync(scriptPath);
    }
  });

  it("thread.started with thread_id null — falls back to thread.id", async () => {
    // thread_id is null (not a string), so the type guard fails.
    // !sessionId is still true, so thread.id fallback fires.
    const scriptPath = "/tmp/cb-adv-codex-thread-null-id.sh";
    writeFileSync(
      scriptPath,
      [
        "#!/bin/sh",
        'echo \'{"type":"thread.started","thread_id":null,"thread":{"id":"fallback-id"}}\'',
      ].join("\n"),
    );
    chmodSync(scriptPath, 0o755);
    try {
      const engine = new CodexEngine({ command: scriptPath });
      const result = await engine.start(makeRequest());
      expect(result.sessionId).toBe("fallback-id");
    } finally {
      unlinkSync(scriptPath);
    }
  });

  it("thread.started with thread_id as empty string — rejects empty string, sessionId is null", async () => {
    // Empty string is not a valid session ID and is now rejected by the engine.
    const scriptPath = "/tmp/cb-adv-codex-thread-empty-id.sh";
    writeFileSync(
      scriptPath,
      [
        "#!/bin/sh",
        'echo \'{"type":"thread.started","thread_id":""}\'',
        'echo \'{"type":"item.completed","item":{"type":"agent_message","text":"done"}}\'',
      ].join("\n"),
    );
    chmodSync(scriptPath, 0o755);
    try {
      const engine = new CodexEngine({ command: scriptPath });
      const result = await engine.start(makeRequest());
      // Empty string thread_id is rejected — sessionId must be null
      expect(result.sessionId).toBeNull();
    } finally {
      unlinkSync(scriptPath);
    }
  });

  // Given a thread.started event where the top-level thread_id is absent/invalid
  // AND the thread.id fallback field is an empty string,
  // When the engine processes the event,
  // Then thread.id empty string must also be rejected (PR #32 fix: `thread.id` guard).
  it("thread.started with thread.id as empty string — rejects empty string fallback, sessionId is null", async () => {
    // thread_id is missing (undefined), so !sessionId is true and the thread.id fallback fires.
    // The fallback guard is: `!sessionId && thread && typeof thread.id === 'string' && thread.id`
    // An empty string is falsy, so it must NOT be captured as the session ID.
    const scriptPath = "/tmp/cb-adv-codex-thread-dot-id-empty.sh";
    writeFileSync(
      scriptPath,
      [
        "#!/bin/sh",
        // thread_id absent, thread.id is empty string
        'echo \'{"type":"thread.started","thread":{"id":""}}\'',
        'echo \'{"type":"item.completed","item":{"type":"agent_message","text":"done"}}\'',
      ].join("\n"),
    );
    chmodSync(scriptPath, 0o755);
    try {
      const engine = new CodexEngine({ command: scriptPath });
      const result = await engine.start(makeRequest());
      // Empty string thread.id is falsy — rejected the same as empty thread_id
      expect(result.sessionId).toBeNull();
      expect(result.output).toBe("done");
    } finally {
      unlinkSync(scriptPath);
    }
  });

  // -----------------------------------------------------------------------
  // JSON lines with missing or unexpected event types
  // -----------------------------------------------------------------------

  it('JSONL with events that have no "type" field — should not crash and falls back correctly', async () => {
    const scriptPath = "/tmp/cb-adv-codex-no-type.sh";
    writeFileSync(
      scriptPath,
      [
        "#!/bin/sh",
        'echo \'{"thread_id":"t1","text":"no type"}\'',
        'echo \'{"data":"something"}\'',
      ].join("\n"),
    );
    chmodSync(scriptPath, 0o755);
    try {
      const engine = new CodexEngine({ command: scriptPath });
      const result = await engine.start(makeRequest());
      // No recognized events fired, textParts is empty, sessionId is null
      // Fallback path returns raw trimmed output
      expect(result.error).toBeUndefined();
      // The fallback returns the raw multi-line string
      expect(result.output).toContain("thread_id");
    } finally {
      unlinkSync(scriptPath);
    }
  });

  it('JSONL with event type "item.completed" but missing "item" field — no crash, no output', async () => {
    const scriptPath = "/tmp/cb-adv-codex-no-item.sh";
    writeFileSync(
      scriptPath,
      ["#!/bin/sh", 'echo \'{"type":"item.completed"}\''].join("\n"),
    );
    chmodSync(scriptPath, 0o755);
    try {
      const engine = new CodexEngine({ command: scriptPath });
      const result = await engine.start(makeRequest());
      expect(result.error).toBeUndefined();
      // item is undefined — the code guards `if (item)`, so no text is extracted.
      // But textParts is empty and sessionId is null, so the fallback runs.
      // Fallback returns raw trimmed: '{"type":"item.completed"}'
      expect(result.output).toBe('{"type":"item.completed"}');
    } finally {
      unlinkSync(scriptPath);
    }
  });

  it('item.completed with item.type === "agent_message" but item.text is null — no text extracted', async () => {
    const scriptPath = "/tmp/cb-adv-codex-null-text.sh";
    writeFileSync(
      scriptPath,
      [
        "#!/bin/sh",
        'echo \'{"type":"thread.started","thread_id":"t1"}\'',
        'echo \'{"type":"item.completed","item":{"type":"agent_message","text":null}}\'',
      ].join("\n"),
    );
    chmodSync(scriptPath, 0o755);
    try {
      const engine = new CodexEngine({ command: scriptPath });
      const result = await engine.start(makeRequest());
      // text is null — type guard `typeof item.text === 'string'` fails, nothing pushed
      expect(result.output).toBe("");
      expect(result.sessionId).toBe("t1");
    } finally {
      unlinkSync(scriptPath);
    }
  });

  it('item.completed with item.type === "agent_message" but item.text is a number — no text extracted', async () => {
    const scriptPath = "/tmp/cb-adv-codex-number-text.sh";
    writeFileSync(
      scriptPath,
      [
        "#!/bin/sh",
        'echo \'{"type":"thread.started","thread_id":"t1"}\'',
        'echo \'{"type":"item.completed","item":{"type":"agent_message","text":999}}\'',
      ].join("\n"),
    );
    chmodSync(scriptPath, 0o755);
    try {
      const engine = new CodexEngine({ command: scriptPath });
      const result = await engine.start(makeRequest());
      expect(result.output).toBe("");
      expect(result.sessionId).toBe("t1");
    } finally {
      unlinkSync(scriptPath);
    }
  });

  // -----------------------------------------------------------------------
  // Interleaved valid/invalid JSONL lines
  // -----------------------------------------------------------------------

  it("interleaved valid and syntactically invalid JSON lines — valid lines still parsed", async () => {
    const scriptPath = "/tmp/cb-adv-codex-interleaved.sh";
    writeFileSync(
      scriptPath,
      [
        "#!/bin/sh",
        'echo \'{"type":"thread.started","thread_id":"t-ok"}\'',
        "echo '{broken json here'",
        "echo 'not json at all'",
        'echo \'{"type":"item.completed","item":{"type":"agent_message","text":"good output"}}\'',
        'echo \'{ "type": "invalid-json-fragment \'',
      ].join("\n"),
    );
    chmodSync(scriptPath, 0o755);
    try {
      const engine = new CodexEngine({ command: scriptPath });
      const result = await engine.start(makeRequest());
      expect(result.sessionId).toBe("t-ok");
      expect(result.output).toBe("good output");
      expect(result.error).toBeUndefined();
    } finally {
      unlinkSync(scriptPath);
    }
  });

  // -----------------------------------------------------------------------
  // Fallback behavior: valid JSON but no recognized events
  // BUG PROBE: Should an all-JSON-but-unrecognized-events output return raw JSON or empty string?
  // -----------------------------------------------------------------------

  it("all lines are valid JSON but no recognized event types — returns raw JSON as output (fallback)", async () => {
    // This probes the fallback path: textParts is empty, sessionId is null,
    // so the condition `textParts.length > 0 || sessionId` is false,
    // and the function returns the raw trimmed string.
    // This means callers get raw JSON noise as the output.
    const scriptPath = "/tmp/cb-adv-codex-unrecognized-events.sh";
    writeFileSync(
      scriptPath,
      [
        "#!/bin/sh",
        'echo \'{"type":"debug.log","message":"internal state"}\'',
        'echo \'{"type":"tool.call","name":"read_file"}\'',
      ].join("\n"),
    );
    chmodSync(scriptPath, 0o755);
    try {
      const engine = new CodexEngine({ command: scriptPath });
      const result = await engine.start(makeRequest());
      expect(result.error).toBeUndefined();
      // BEHAVIOR UNDER TEST: raw JSON gets returned as output
      // This is a potential bug — callers may not expect raw JSON event lines as output
      expect(result.output).toContain('{"type":"debug.log"');
    } finally {
      unlinkSync(scriptPath);
    }
  });

  // -----------------------------------------------------------------------
  // message.completed / response.completed edge cases
  // -----------------------------------------------------------------------

  it("message.completed with content array containing non-text parts — skips non-text, extracts text", async () => {
    const scriptPath = "/tmp/cb-adv-codex-mixed-content.sh";
    writeFileSync(
      scriptPath,
      [
        "#!/bin/sh",
        `echo '{"type":"message.completed","message":{"content":[{"type":"image","data":"base64..."},{"type":"text","text":"text part"},{"type":"tool_use","name":"bash"}]}}'`,
      ].join("\n"),
    );
    chmodSync(scriptPath, 0o755);
    try {
      const engine = new CodexEngine({ command: scriptPath });
      const result = await engine.start(makeRequest());
      expect(result.output).toBe("text part");
    } finally {
      unlinkSync(scriptPath);
    }
  });

  it("response.completed with output_text shorthand in response object", async () => {
    const scriptPath = "/tmp/cb-adv-codex-response-output-text.sh";
    writeFileSync(
      scriptPath,
      [
        "#!/bin/sh",
        `echo '{"type":"response.completed","response":{"output_text":"response shorthand"}}'`,
      ].join("\n"),
    );
    chmodSync(scriptPath, 0o755);
    try {
      const engine = new CodexEngine({ command: scriptPath });
      const result = await engine.start(makeRequest());
      expect(result.output).toBe("response shorthand");
    } finally {
      unlinkSync(scriptPath);
    }
  });

  it("message.completed with content: null — no crash, no output", async () => {
    const scriptPath = "/tmp/cb-adv-codex-null-content.sh";
    writeFileSync(
      scriptPath,
      [
        "#!/bin/sh",
        `echo '{"type":"message.completed","message":{"content":null}}'`,
      ].join("\n"),
    );
    chmodSync(scriptPath, 0o755);
    try {
      const engine = new CodexEngine({ command: scriptPath });
      const result = await engine.start(makeRequest());
      expect(result.error).toBeUndefined();
      // content is null, !Array.isArray(null), so nothing pushed
      // But textParts is empty and sessionId is null → fallback returns raw JSON
      expect(result.output).toContain("message.completed");
    } finally {
      unlinkSync(scriptPath);
    }
  });

  it("message.completed with content: [] (empty array) — returns empty string output", async () => {
    const scriptPath = "/tmp/cb-adv-codex-empty-content.sh";
    writeFileSync(
      scriptPath,
      [
        "#!/bin/sh",
        `echo '{"type":"thread.started","thread_id":"t1"}'`,
        `echo '{"type":"message.completed","message":{"content":[]}}'`,
      ].join("\n"),
    );
    chmodSync(scriptPath, 0o755);
    try {
      const engine = new CodexEngine({ command: scriptPath });
      const result = await engine.start(makeRequest());
      // sessionId is set, so the main path fires (not fallback)
      expect(result.sessionId).toBe("t1");
      expect(result.output).toBe("");
    } finally {
      unlinkSync(scriptPath);
    }
  });

  // -----------------------------------------------------------------------
  // Very long single line in JSONL
  // -----------------------------------------------------------------------

  it("very long single line in JSONL — parses correctly without truncation below 10MB", async () => {
    const scriptPath = "/tmp/cb-adv-codex-long-line.sh";
    // Build a long text string (~100KB)
    const longText = "x".repeat(100_000);
    writeFileSync(
      scriptPath,
      [
        "#!/bin/sh",
        `echo '{"type":"thread.started","thread_id":"t-long"}'`,
        `echo '{"type":"item.completed","item":{"type":"agent_message","text":"${longText}"}}'`,
      ].join("\n"),
    );
    chmodSync(scriptPath, 0o755);
    try {
      const engine = new CodexEngine({ command: scriptPath });
      const result = await engine.start(makeRequest());
      expect(result.sessionId).toBe("t-long");
      expect(result.output).toBe(longText);
      expect(result.error).toBeUndefined();
    } finally {
      unlinkSync(scriptPath);
    }
  });

  // -----------------------------------------------------------------------
  // Empty JSONL output (whitespace only)
  // -----------------------------------------------------------------------

  it("output with only whitespace/newlines — returns empty string", async () => {
    const scriptPath = "/tmp/cb-adv-codex-whitespace.sh";
    writeFileSync(
      scriptPath,
      ["#!/bin/sh", 'printf "   \\n\\n   \\n"'].join("\n"),
    );
    chmodSync(scriptPath, 0o755);
    try {
      const engine = new CodexEngine({ command: scriptPath });
      const result = await engine.start(makeRequest());
      expect(result.output).toBe("");
      expect(result.sessionId).toBeNull();
      expect(result.error).toBeUndefined();
    } finally {
      unlinkSync(scriptPath);
    }
  });

  // -----------------------------------------------------------------------
  // exec event without expected structure (unknown exec-like event types)
  // -----------------------------------------------------------------------

  it("exec event type (not a recognized type) — treated as unknown, raw fallback", async () => {
    const scriptPath = "/tmp/cb-adv-codex-exec-event.sh";
    writeFileSync(
      scriptPath,
      [
        "#!/bin/sh",
        `echo '{"type":"exec","command":"ls -la","output":"file1\\nfile2"}'`,
      ].join("\n"),
    );
    chmodSync(scriptPath, 0o755);
    try {
      const engine = new CodexEngine({ command: scriptPath });
      const result = await engine.start(makeRequest());
      expect(result.error).toBeUndefined();
      // No known event type matched, so fallback returns raw JSON string
      expect(result.output).toContain('"type":"exec"');
    } finally {
      unlinkSync(scriptPath);
    }
  });

  // -----------------------------------------------------------------------
  // item.completed with item.type "message" and content parts
  // -----------------------------------------------------------------------

  it('item.completed message type with text part type "text" — also extracted', async () => {
    const scriptPath = "/tmp/cb-adv-codex-item-text-type.sh";
    writeFileSync(
      scriptPath,
      [
        "#!/bin/sh",
        `echo '{"type":"item.completed","item":{"type":"message","content":[{"type":"text","text":"text-type content"}]}}'`,
      ].join("\n"),
    );
    chmodSync(scriptPath, 0o755);
    try {
      const engine = new CodexEngine({ command: scriptPath });
      const result = await engine.start(makeRequest());
      expect(result.output).toBe("text-type content");
    } finally {
      unlinkSync(scriptPath);
    }
  });

  it('item.completed message type with content parts lacking "text" string — skipped, fallback returns raw JSON', async () => {
    const scriptPath = "/tmp/cb-adv-codex-item-bad-content.sh";
    writeFileSync(
      scriptPath,
      [
        "#!/bin/sh",
        `echo '{"type":"item.completed","item":{"type":"message","content":[{"type":"output_text","text":null}]}}'`,
      ].join("\n"),
    );
    chmodSync(scriptPath, 0o755);
    try {
      const engine = new CodexEngine({ command: scriptPath });
      const result = await engine.start(makeRequest());
      expect(result.error).toBeUndefined();
      // text is null — skipped; nothing recognized → raw fallback
      expect(result.output).toContain('"type":"item.completed"');
    } finally {
      unlinkSync(scriptPath);
    }
  });

  // -----------------------------------------------------------------------
  // Multiple agent_message items — all concatenated
  // -----------------------------------------------------------------------

  it("multiple item.completed agent_message events — all text concatenated in order", async () => {
    const scriptPath = "/tmp/cb-adv-codex-multi-msg.sh";
    writeFileSync(
      scriptPath,
      [
        "#!/bin/sh",
        `echo '{"type":"item.completed","item":{"type":"agent_message","text":"Part 1. "}}'`,
        `echo '{"type":"item.completed","item":{"type":"agent_message","text":"Part 2. "}}'`,
        `echo '{"type":"item.completed","item":{"type":"agent_message","text":"Part 3."}}'`,
      ].join("\n"),
    );
    chmodSync(scriptPath, 0o755);
    try {
      const engine = new CodexEngine({ command: scriptPath });
      const result = await engine.start(makeRequest());
      expect(result.output).toBe("Part 1. Part 2. Part 3.");
    } finally {
      unlinkSync(scriptPath);
    }
  });

  // -----------------------------------------------------------------------
  // thread.started appears AFTER another thread.started — first one wins?
  // -----------------------------------------------------------------------

  it("two thread.started events — first thread_id wins (sessionId not overwritten)", async () => {
    // The engine now guards assignment with `!sessionId`, so the first valid
    // thread_id is captured and subsequent thread.started events do not overwrite it.
    const scriptPath = "/tmp/cb-adv-codex-two-threads.sh";
    writeFileSync(
      scriptPath,
      [
        "#!/bin/sh",
        `echo '{"type":"thread.started","thread_id":"first-id"}'`,
        `echo '{"type":"thread.started","thread_id":"second-id"}'`,
      ].join("\n"),
    );
    chmodSync(scriptPath, 0o755);
    try {
      const engine = new CodexEngine({ command: scriptPath });
      const result = await engine.start(makeRequest());
      // First thread_id wins — subsequent thread.started events are ignored
      expect(result.sessionId).toBe("first-id");
    } finally {
      unlinkSync(scriptPath);
    }
  });
});

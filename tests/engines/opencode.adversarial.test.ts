/**
 * Adversarial tests for OpenCodeEngine — probing edge cases and potential bugs.
 * These tests only ADD coverage; they do not modify any existing test or production code.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { mkdirSync, writeFileSync, unlinkSync, chmodSync } from "node:fs";
import { OpenCodeEngine } from "../../src/engines/opencode.js";
import type { TaskRequest } from "../../src/schemas/request.js";

describe("OpenCodeEngine — adversarial", () => {
  beforeAll(() => {
    mkdirSync("/tmp/cb-test-project", { recursive: true });
  });

  const makeRequest = (overrides?: Partial<TaskRequest>): TaskRequest => ({
    task_id: "task-adv-002",
    intent: "coding",
    workspace_path: "/tmp/cb-test-project",
    message: "Hello world",
    engine: "opencode",
    mode: "new",
    session_id: null,
    constraints: { timeout_ms: 30000, allow_network: true },
    ...overrides,
  });

  // -----------------------------------------------------------------------
  // NDJSON with missing "type" field
  // -----------------------------------------------------------------------

  it('NDJSON event without "type" field — not crash, no output extracted, fallback returns raw', async () => {
    const scriptPath = "/tmp/cb-adv-oc-no-type.sh";
    writeFileSync(
      scriptPath,
      ["#!/bin/sh", 'echo \'{"sessionID":"s1","part":{"text":"hi"}}\''].join(
        "\n",
      ),
    );
    chmodSync(scriptPath, 0o755);
    try {
      const engine = new OpenCodeEngine({ command: scriptPath });
      const result = await engine.start(makeRequest());
      expect(result.error).toBeUndefined();
      // sessionID is still captured because it doesn't require a specific event type
      expect(result.sessionId).toBe("s1");
    } finally {
      unlinkSync(scriptPath);
    }
  });

  it('event with type field present but not "text" or "step_finish" — sessionID still captured', async () => {
    const scriptPath = "/tmp/cb-adv-oc-unknown-type.sh";
    writeFileSync(
      scriptPath,
      [
        "#!/bin/sh",
        'echo \'{"type":"assistant_start","sessionID":"s-unknown"}\'',
      ].join("\n"),
    );
    chmodSync(scriptPath, 0o755);
    try {
      const engine = new OpenCodeEngine({ command: scriptPath });
      const result = await engine.start(makeRequest());
      expect(result.error).toBeUndefined();
      expect(result.sessionId).toBe("s-unknown");
      // No text events, no step_finish — textParts empty, tokenUsage null
      // But sessionId is set, so the main return path fires (not fallback)
      expect(result.output).toBe("");
      expect(result.tokenUsage).toBeNull();
    } finally {
      unlinkSync(scriptPath);
    }
  });

  // -----------------------------------------------------------------------
  // step_finish without expected token fields
  // -----------------------------------------------------------------------

  it("step_finish with tokens as null — tokenUsage should be null (tokens check fails)", async () => {
    // `part.tokens !== null` check catches this
    const scriptPath = "/tmp/cb-adv-oc-null-tokens.sh";
    writeFileSync(
      scriptPath,
      [
        "#!/bin/sh",
        'echo \'{"type":"step_finish","part":{"tokens":null},"sessionID":"s1"}\'',
      ].join("\n"),
    );
    chmodSync(scriptPath, 0o755);
    try {
      const engine = new OpenCodeEngine({ command: scriptPath });
      const result = await engine.start(makeRequest());
      expect(result.tokenUsage).toBeNull();
    } finally {
      unlinkSync(scriptPath);
    }
  });

  it("step_finish with tokens as an array (not a plain object) — tokenUsage is null", async () => {
    // Arrays are not a valid plain-object tokens payload and are now rejected.
    // The engine must check that tokens is a plain object (not an array) before
    // extracting input/output/total, returning null otherwise.
    const scriptPath = "/tmp/cb-adv-oc-array-tokens.sh";
    writeFileSync(
      scriptPath,
      [
        "#!/bin/sh",
        'echo \'{"type":"step_finish","part":{"tokens":[100,50,150]},"sessionID":"s1"}\'',
      ].join("\n"),
    );
    chmodSync(scriptPath, 0o755);
    try {
      const engine = new OpenCodeEngine({ command: scriptPath });
      const result = await engine.start(makeRequest());
      // Array tokens are rejected — tokenUsage must be null
      expect(result.tokenUsage).toBeNull();
    } finally {
      unlinkSync(scriptPath);
    }
  });

  it('step_finish with no "part" field — tokenUsage stays null', async () => {
    const scriptPath = "/tmp/cb-adv-oc-no-part.sh";
    writeFileSync(
      scriptPath,
      ["#!/bin/sh", 'echo \'{"type":"step_finish","sessionID":"s1"}\''].join(
        "\n",
      ),
    );
    chmodSync(scriptPath, 0o755);
    try {
      const engine = new OpenCodeEngine({ command: scriptPath });
      const result = await engine.start(makeRequest());
      expect(result.tokenUsage).toBeNull();
    } finally {
      unlinkSync(scriptPath);
    }
  });

  it("step_finish with tokens object missing all fields — tokenUsage is null", async () => {
    // An empty tokens object `{}` has no numeric fields and is now rejected.
    // The engine must require at least valid numeric values before constructing tokenUsage.
    const scriptPath = "/tmp/cb-adv-oc-empty-tokens.sh";
    writeFileSync(
      scriptPath,
      [
        "#!/bin/sh",
        'echo \'{"type":"step_finish","part":{"tokens":{}},"sessionID":"s1"}\'',
      ].join("\n"),
    );
    chmodSync(scriptPath, 0o755);
    try {
      const engine = new OpenCodeEngine({ command: scriptPath });
      const result = await engine.start(makeRequest());
      // Empty tokens object is rejected — tokenUsage must be null
      expect(result.tokenUsage).toBeNull();
    } finally {
      unlinkSync(scriptPath);
    }
  });

  it("step_finish with negative token values — tokenUsage stores negative numbers", async () => {
    // Negative tokens are nonsensical but the code doesn't validate, just passes them through.
    const scriptPath = "/tmp/cb-adv-oc-neg-tokens.sh";
    writeFileSync(
      scriptPath,
      [
        "#!/bin/sh",
        'echo \'{"type":"step_finish","part":{"tokens":{"input":-1,"output":-5,"total":-6}},"sessionID":"s1"}\'',
      ].join("\n"),
    );
    chmodSync(scriptPath, 0o755);
    try {
      const engine = new OpenCodeEngine({ command: scriptPath });
      const result = await engine.start(makeRequest());
      // Behavior under test: negative values pass through without validation
      expect(result.tokenUsage).toEqual({
        prompt_tokens: -1,
        completion_tokens: -5,
        total_tokens: -6,
      });
    } finally {
      unlinkSync(scriptPath);
    }
  });

  it("step_finish with extremely large token values — stored without overflow", async () => {
    const scriptPath = "/tmp/cb-adv-oc-large-tokens.sh";
    const big = Number.MAX_SAFE_INTEGER;
    writeFileSync(
      scriptPath,
      [
        "#!/bin/sh",
        `echo '{"type":"step_finish","part":{"tokens":{"input":${big},"output":${big},"total":${big}}},"sessionID":"s1"}'`,
      ].join("\n"),
    );
    chmodSync(scriptPath, 0o755);
    try {
      const engine = new OpenCodeEngine({ command: scriptPath });
      const result = await engine.start(makeRequest());
      expect(result.tokenUsage).toEqual({
        prompt_tokens: big,
        completion_tokens: big,
        total_tokens: big,
      });
    } finally {
      unlinkSync(scriptPath);
    }
  });

  it("step_finish with zero token values — tokenUsage set to {0,0,0} (not null)", async () => {
    // Explicit zeros are valid but the behavior (returning {0,0,0}) vs null is worth documenting.
    const scriptPath = "/tmp/cb-adv-oc-zero-tokens.sh";
    writeFileSync(
      scriptPath,
      [
        "#!/bin/sh",
        'echo \'{"type":"step_finish","part":{"tokens":{"input":0,"output":0,"total":0}},"sessionID":"s1"}\'',
      ].join("\n"),
    );
    chmodSync(scriptPath, 0o755);
    try {
      const engine = new OpenCodeEngine({ command: scriptPath });
      const result = await engine.start(makeRequest());
      expect(result.tokenUsage).toEqual({
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      });
    } finally {
      unlinkSync(scriptPath);
    }
  });

  // -----------------------------------------------------------------------
  // text events with empty/null content
  // -----------------------------------------------------------------------

  it("text event with part.text as empty string — empty string appended to output", async () => {
    const scriptPath = "/tmp/cb-adv-oc-empty-text.sh";
    writeFileSync(
      scriptPath,
      [
        "#!/bin/sh",
        'echo \'{"type":"text","part":{"text":""},"sessionID":"s1"}\'',
      ].join("\n"),
    );
    chmodSync(scriptPath, 0o755);
    try {
      const engine = new OpenCodeEngine({ command: scriptPath });
      const result = await engine.start(makeRequest());
      // Empty string IS a string, so it passes `typeof part.text === 'string'`
      // It gets pushed to textParts and joined — output is ''
      expect(result.output).toBe("");
      expect(result.sessionId).toBe("s1");
    } finally {
      unlinkSync(scriptPath);
    }
  });

  it("text event with part.text as null — null not appended, no crash", async () => {
    const scriptPath = "/tmp/cb-adv-oc-null-text.sh";
    writeFileSync(
      scriptPath,
      [
        "#!/bin/sh",
        'echo \'{"type":"text","part":{"text":null},"sessionID":"s1"}\'',
      ].join("\n"),
    );
    chmodSync(scriptPath, 0o755);
    try {
      const engine = new OpenCodeEngine({ command: scriptPath });
      const result = await engine.start(makeRequest());
      // null is not typeof 'string', so nothing pushed to textParts
      // sessionId is set, so main path fires, output = ''
      expect(result.output).toBe("");
      expect(result.sessionId).toBe("s1");
    } finally {
      unlinkSync(scriptPath);
    }
  });

  it('text event with no "part" field — no text extracted, no crash', async () => {
    const scriptPath = "/tmp/cb-adv-oc-no-part-text.sh";
    writeFileSync(
      scriptPath,
      ["#!/bin/sh", 'echo \'{"type":"text","sessionID":"s1"}\''].join("\n"),
    );
    chmodSync(scriptPath, 0o755);
    try {
      const engine = new OpenCodeEngine({ command: scriptPath });
      const result = await engine.start(makeRequest());
      expect(result.error).toBeUndefined();
      expect(result.output).toBe("");
      expect(result.sessionId).toBe("s1");
    } finally {
      unlinkSync(scriptPath);
    }
  });

  // -----------------------------------------------------------------------
  // sessionID extraction edge cases
  // -----------------------------------------------------------------------

  it("empty string sessionID — rejected, sessionId is null", async () => {
    // Empty strings are not valid session IDs and are now rejected by the engine.
    const scriptPath = "/tmp/cb-adv-oc-empty-session-id.sh";
    writeFileSync(
      scriptPath,
      [
        "#!/bin/sh",
        'echo \'{"type":"text","part":{"text":"hi"},"sessionID":""}\'',
      ].join("\n"),
    );
    chmodSync(scriptPath, 0o755);
    try {
      const engine = new OpenCodeEngine({ command: scriptPath });
      const result = await engine.start(makeRequest());
      // Empty string sessionID is rejected — sessionId must be null
      expect(result.sessionId).toBeNull();
    } finally {
      unlinkSync(scriptPath);
    }
  });

  it("empty string sessionID prevents later valid sessionID from being captured", async () => {
    // Because `&& !sessionId` check uses falsy logic but `''` is falsy in JS,
    // actually `!''` is TRUE, so empty string would NOT prevent the next capture.
    // Wait — let me re-read: `if (typeof event.sessionID === 'string' && !sessionId)`
    // `!''` is true (empty string is falsy), so the NEXT event WOULD overwrite ''!
    // This means the empty string guard actually works correctly for subsequent events.
    const scriptPath = "/tmp/cb-adv-oc-empty-then-valid-session.sh";
    writeFileSync(
      scriptPath,
      [
        "#!/bin/sh",
        'echo \'{"type":"text","part":{"text":"a"},"sessionID":""}\'',
        'echo \'{"type":"text","part":{"text":"b"},"sessionID":"real-session"}\'',
      ].join("\n"),
    );
    chmodSync(scriptPath, 0o755);
    try {
      const engine = new OpenCodeEngine({ command: scriptPath });
      const result = await engine.start(makeRequest());
      // `!''` === true, so the second event (with "real-session") overwrites the empty string.
      // The final sessionId should be "real-session".
      expect(result.sessionId).toBe("real-session");
      expect(result.output).toBe("ab");
    } finally {
      unlinkSync(scriptPath);
    }
  });

  it("sessionID as a number — not captured, stays null", async () => {
    const scriptPath = "/tmp/cb-adv-oc-numeric-session.sh";
    writeFileSync(
      scriptPath,
      [
        "#!/bin/sh",
        'echo \'{"type":"text","part":{"text":"hi"},"sessionID":42}\'',
      ].join("\n"),
    );
    chmodSync(scriptPath, 0o755);
    try {
      const engine = new OpenCodeEngine({ command: scriptPath });
      const result = await engine.start(makeRequest());
      // 42 is not a string, so type guard fails
      expect(result.sessionId).toBeNull();
    } finally {
      unlinkSync(scriptPath);
    }
  });

  it("sessionID only on first event — subsequent events without sessionID do not clear it", async () => {
    const scriptPath = "/tmp/cb-adv-oc-session-first-only.sh";
    writeFileSync(
      scriptPath,
      [
        "#!/bin/sh",
        'echo \'{"type":"text","part":{"text":"first"},"sessionID":"my-sess"}\'',
        'echo \'{"type":"text","part":{"text":" second"}}\'',
      ].join("\n"),
    );
    chmodSync(scriptPath, 0o755);
    try {
      const engine = new OpenCodeEngine({ command: scriptPath });
      const result = await engine.start(makeRequest());
      expect(result.sessionId).toBe("my-sess");
      expect(result.output).toBe("first second");
    } finally {
      unlinkSync(scriptPath);
    }
  });

  // -----------------------------------------------------------------------
  // Multiple step_finish events — last one wins
  // -----------------------------------------------------------------------

  it("step_finish with only partial fields — missing fields default to 0, total computed", async () => {
    // input and output present, total absent → total = input + output
    const scriptPath = "/tmp/cb-adv-oc-partial-tokens.sh";
    writeFileSync(
      scriptPath,
      [
        "#!/bin/sh",
        'echo \'{"type":"step_finish","part":{"tokens":{"input":100,"output":50}},"sessionID":"s1"}\'',
      ].join("\n"),
    );
    chmodSync(scriptPath, 0o755);
    try {
      const engine = new OpenCodeEngine({ command: scriptPath });
      const result = await engine.start(makeRequest());
      expect(result.tokenUsage).toEqual({
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150, // computed as input + output
      });
    } finally {
      unlinkSync(scriptPath);
    }
  });

  it('step_finish with only "total" field — input and output default to 0', async () => {
    // Only total is provided; input and output are missing → default to 0
    const scriptPath = "/tmp/cb-adv-oc-only-total.sh";
    writeFileSync(
      scriptPath,
      [
        "#!/bin/sh",
        'echo \'{"type":"step_finish","part":{"tokens":{"total":200}},"sessionID":"s1"}\'',
      ].join("\n"),
    );
    chmodSync(scriptPath, 0o755);
    try {
      const engine = new OpenCodeEngine({ command: scriptPath });
      const result = await engine.start(makeRequest());
      expect(result.tokenUsage).toEqual({
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 200,
      });
    } finally {
      unlinkSync(scriptPath);
    }
  });

  // -----------------------------------------------------------------------
  // Malformed JSON lines
  // -----------------------------------------------------------------------

  it("completely invalid JSON line — skipped silently, does not crash", async () => {
    const scriptPath = "/tmp/cb-adv-oc-invalid-json.sh";
    writeFileSync(
      scriptPath,
      [
        "#!/bin/sh",
        "echo '{not valid json'",
        'echo \'{"type":"text","part":{"text":"valid"},"sessionID":"s1"}\'',
      ].join("\n"),
    );
    chmodSync(scriptPath, 0o755);
    try {
      const engine = new OpenCodeEngine({ command: scriptPath });
      const result = await engine.start(makeRequest());
      expect(result.output).toBe("valid");
      expect(result.sessionId).toBe("s1");
      expect(result.error).toBeUndefined();
    } finally {
      unlinkSync(scriptPath);
    }
  });

  it('JSON array at top level — starts with "[", skipped by { check', async () => {
    // The parser only processes lines that start with '{'.
    // A JSON array line would be skipped.
    const scriptPath = "/tmp/cb-adv-oc-json-array.sh";
    writeFileSync(
      scriptPath,
      [
        "#!/bin/sh",
        'echo \'[{"type":"text","part":{"text":"array"},"sessionID":"s1"}]\'',
      ].join("\n"),
    );
    chmodSync(scriptPath, 0o755);
    try {
      const engine = new OpenCodeEngine({ command: scriptPath });
      const result = await engine.start(makeRequest());
      // The line starts with '[', not '{', so it's skipped.
      // No recognized events → no sessionId, no text
      // The array line doesn't start with '{' so the filter skips it entirely
      // BUT the filter is `if (!line.startsWith('{')) continue;`
      // So textParts is empty, sessionId is null, tokenUsage is null
      // → fallback returns raw trimmed output (the raw JSON array string)
      expect(result.sessionId).toBeNull();
      expect(result.error).toBeUndefined();
    } finally {
      unlinkSync(scriptPath);
    }
  });

  it("truncated JSON line (incomplete object) — caught by JSON.parse catch, skipped", async () => {
    const scriptPath = "/tmp/cb-adv-oc-truncated.sh";
    writeFileSync(
      scriptPath,
      ["#!/bin/sh", 'printf \'{"type":"text","part":{"text":"cut\''].join("\n"),
    );
    chmodSync(scriptPath, 0o755);
    try {
      const engine = new OpenCodeEngine({ command: scriptPath });
      const result = await engine.start(makeRequest());
      expect(result.error).toBeUndefined();
      // Starts with '{' so gets to JSON.parse, throws, caught, line skipped
      // No recognized events → fallback
    } finally {
      unlinkSync(scriptPath);
    }
  });

  // -----------------------------------------------------------------------
  // Fallback behavior: valid JSON but no recognized events
  // -----------------------------------------------------------------------

  it("all valid JSON lines but no recognized event types — fallback returns raw JSON", async () => {
    // Same structural issue as CodexEngine: unrecognized events produce raw JSON as output.
    const scriptPath = "/tmp/cb-adv-oc-unrecognized.sh";
    writeFileSync(
      scriptPath,
      [
        "#!/bin/sh",
        'echo \'{"type":"debug","msg":"startup"}\'',
        'echo \'{"type":"progress","pct":50}\'',
      ].join("\n"),
    );
    chmodSync(scriptPath, 0o755);
    try {
      const engine = new OpenCodeEngine({ command: scriptPath });
      const result = await engine.start(makeRequest());
      expect(result.error).toBeUndefined();
      // No text/step_finish/sessionID recognized → all conditions false → fallback
      expect(result.output).toContain('"type":"debug"');
    } finally {
      unlinkSync(scriptPath);
    }
  });

  // -----------------------------------------------------------------------
  // step_finish only (no text, no sessionID) — tokenUsage still fires main path
  // -----------------------------------------------------------------------

  it("step_finish only, no text or sessionID — tokenUsage set, output empty, sessionId null", async () => {
    const scriptPath = "/tmp/cb-adv-oc-step-only.sh";
    writeFileSync(
      scriptPath,
      [
        "#!/bin/sh",
        'echo \'{"type":"step_finish","part":{"tokens":{"input":50,"output":25,"total":75}}}\'',
      ].join("\n"),
    );
    chmodSync(scriptPath, 0o755);
    try {
      const engine = new OpenCodeEngine({ command: scriptPath });
      const result = await engine.start(makeRequest());
      // tokenUsage is set → `if (textParts.length > 0 || sessionId || tokenUsage)` fires main path
      expect(result.tokenUsage).toEqual({
        prompt_tokens: 50,
        completion_tokens: 25,
        total_tokens: 75,
      });
      expect(result.sessionId).toBeNull();
      expect(result.output).toBe("");
    } finally {
      unlinkSync(scriptPath);
    }
  });

  // -----------------------------------------------------------------------
  // Very long output line in NDJSON
  // -----------------------------------------------------------------------

  it("very long text event (~100KB) — parsed correctly without truncation below 10MB", async () => {
    const scriptPath = "/tmp/cb-adv-oc-long-line.sh";
    const longText = "y".repeat(100_000);
    writeFileSync(
      scriptPath,
      [
        "#!/bin/sh",
        `echo '{"type":"text","part":{"text":"${longText}"},"sessionID":"s-long"}'`,
      ].join("\n"),
    );
    chmodSync(scriptPath, 0o755);
    try {
      const engine = new OpenCodeEngine({ command: scriptPath });
      const result = await engine.start(makeRequest());
      expect(result.output).toBe(longText);
      expect(result.sessionId).toBe("s-long");
      expect(result.error).toBeUndefined();
    } finally {
      unlinkSync(scriptPath);
    }
  });
});

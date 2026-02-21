/**
 * Adversarial tests for the Engine registry (resolveEngine).
 * These tests only ADD coverage; they do not modify any existing test or production code.
 */
import { describe, it, expect } from "vitest";
import { resolveEngine } from "../../src/engines/index.js";
import { ClaudeCodeEngine } from "../../src/engines/claude-code.js";
import { KimiCodeEngine } from "../../src/engines/kimi-code.js";
import { OpenCodeEngine } from "../../src/engines/opencode.js";
import { CodexEngine } from "../../src/engines/codex.js";

describe("resolveEngine — adversarial", () => {
  // -----------------------------------------------------------------------
  // Case sensitivity
  // -----------------------------------------------------------------------

  it('throws for uppercase "CODEX"', () => {
    expect(() => resolveEngine("CODEX")).toThrow("Unknown engine: CODEX");
  });

  it('throws for uppercase "OPENCODE"', () => {
    expect(() => resolveEngine("OPENCODE")).toThrow("Unknown engine: OPENCODE");
  });

  it('throws for mixed-case "Claude-Code"', () => {
    expect(() => resolveEngine("Claude-Code")).toThrow(
      "Unknown engine: Claude-Code",
    );
  });

  it('throws for mixed-case "Kimi-Code"', () => {
    expect(() => resolveEngine("Kimi-Code")).toThrow(
      "Unknown engine: Kimi-Code",
    );
  });

  it('throws for "codex " (trailing space)', () => {
    expect(() => resolveEngine("codex ")).toThrow("Unknown engine: codex ");
  });

  it('throws for " codex" (leading space)', () => {
    expect(() => resolveEngine(" codex")).toThrow("Unknown engine:  codex");
  });

  // -----------------------------------------------------------------------
  // Empty and near-empty engine names
  // -----------------------------------------------------------------------

  it('throws for empty string ""', () => {
    expect(() => resolveEngine("")).toThrow("Unknown engine: ");
  });

  it('throws for whitespace-only string " "', () => {
    expect(() => resolveEngine(" ")).toThrow("Unknown engine:  ");
  });

  // -----------------------------------------------------------------------
  // null / undefined coerced to string
  // -----------------------------------------------------------------------

  it('throws for null coerced to string — error message contains "null"', () => {
    // TypeScript signature is string, but JS callers may pass null.
    // `String(null).slice(0,64)` === 'null', so the error message says "Unknown engine: null".
    expect(() => resolveEngine(null as unknown as string)).toThrow(
      "Unknown engine: null",
    );
  });

  it('throws for undefined coerced to string — error message contains "undefined"', () => {
    // `String(undefined).slice(0,64)` === 'undefined'
    expect(() => resolveEngine(undefined as unknown as string)).toThrow(
      "Unknown engine: undefined",
    );
  });

  // -----------------------------------------------------------------------
  // Long engine name — truncated in error message at 64 chars
  // -----------------------------------------------------------------------

  it("error message truncates very long engine name to 64 characters", () => {
    const longName = "a".repeat(128);
    let threw = false;
    try {
      resolveEngine(longName);
    } catch (err) {
      threw = true;
      const msg = (err as Error).message;
      // The error message should contain at most 64 chars of the name
      expect(msg).toBe(`Unknown engine: ${"a".repeat(64)}`);
    }
    expect(threw).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Confirm each known engine returns a fresh instance each call
  // -----------------------------------------------------------------------

  it('each call to resolveEngine("codex") returns a new CodexEngine instance', () => {
    const e1 = resolveEngine("codex");
    const e2 = resolveEngine("codex");
    expect(e1).toBeInstanceOf(CodexEngine);
    expect(e2).toBeInstanceOf(CodexEngine);
    expect(e1).not.toBe(e2); // different instances
  });

  it('each call to resolveEngine("opencode") returns a new OpenCodeEngine instance', () => {
    const e1 = resolveEngine("opencode");
    const e2 = resolveEngine("opencode");
    expect(e1).toBeInstanceOf(OpenCodeEngine);
    expect(e2).toBeInstanceOf(OpenCodeEngine);
    expect(e1).not.toBe(e2);
  });

  it('each call to resolveEngine("claude-code") returns a new ClaudeCodeEngine instance', () => {
    const e1 = resolveEngine("claude-code");
    const e2 = resolveEngine("claude-code");
    expect(e1).toBeInstanceOf(ClaudeCodeEngine);
    expect(e2).toBeInstanceOf(ClaudeCodeEngine);
    expect(e1).not.toBe(e2);
  });

  it('each call to resolveEngine("kimi-code") returns a new KimiCodeEngine instance', () => {
    const e1 = resolveEngine("kimi-code");
    const e2 = resolveEngine("kimi-code");
    expect(e1).toBeInstanceOf(KimiCodeEngine);
    expect(e2).toBeInstanceOf(KimiCodeEngine);
    expect(e1).not.toBe(e2);
  });

  // -----------------------------------------------------------------------
  // Plausible near-miss names (common typos / alternate spellings)
  // -----------------------------------------------------------------------

  it('throws for "claude_code" (underscore instead of hyphen)', () => {
    expect(() => resolveEngine("claude_code")).toThrow(
      "Unknown engine: claude_code",
    );
  });

  it('throws for "claudecode" (no separator)', () => {
    expect(() => resolveEngine("claudecode")).toThrow(
      "Unknown engine: claudecode",
    );
  });

  it('throws for "kimi" (partial name)', () => {
    expect(() => resolveEngine("kimi")).toThrow("Unknown engine: kimi");
  });

  it('throws for "open-code" (hyphenated variant of opencode)', () => {
    expect(() => resolveEngine("open-code")).toThrow(
      "Unknown engine: open-code",
    );
  });

  it('throws for "gpt-4o" (unregistered engine)', () => {
    expect(() => resolveEngine("gpt-4o")).toThrow("Unknown engine: gpt-4o");
  });

  // -----------------------------------------------------------------------
  // Returned engines satisfy the Engine interface (have correct methods)
  // -----------------------------------------------------------------------

  it("codex engine has start, send, stop methods", () => {
    const engine = resolveEngine("codex");
    expect(typeof engine.start).toBe("function");
    expect(typeof engine.send).toBe("function");
    expect(typeof engine.stop).toBe("function");
  });

  it("opencode engine has start, send, stop methods", () => {
    const engine = resolveEngine("opencode");
    expect(typeof engine.start).toBe("function");
    expect(typeof engine.send).toBe("function");
    expect(typeof engine.stop).toBe("function");
  });
});

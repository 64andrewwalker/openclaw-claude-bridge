import { describe, it, expect } from 'vitest';
import { resolveEngine } from '../../src/engines/index.js';
import { ClaudeCodeEngine } from '../../src/engines/claude-code.js';
import { KimiCodeEngine } from '../../src/engines/kimi-code.js';

describe('resolveEngine', () => {
  it('returns ClaudeCodeEngine for claude-code', () => {
    const engine = resolveEngine('claude-code');
    expect(engine).toBeInstanceOf(ClaudeCodeEngine);
  });

  it('returns KimiCodeEngine for kimi-code', () => {
    const engine = resolveEngine('kimi-code');
    expect(engine).toBeInstanceOf(KimiCodeEngine);
  });

  it('throws for unknown engine name', () => {
    expect(() => resolveEngine('unknown-engine')).toThrow('Unknown engine: unknown-engine');
  });
});

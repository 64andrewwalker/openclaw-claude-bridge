import { describe, it, expect } from 'vitest';
import { resolveEngine } from '../../src/engines/index';
import { ClaudeCodeEngine } from '../../src/engines/claude-code';
import { KimiCodeEngine } from '../../src/engines/kimi-code';

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

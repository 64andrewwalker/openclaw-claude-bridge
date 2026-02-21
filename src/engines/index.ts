import type { Engine } from '../core/engine.js';
import { ClaudeCodeEngine } from './claude-code.js';
import { KimiCodeEngine } from './kimi-code.js';
import { OpenCodeEngine } from './opencode.js';
import { CodexEngine } from './codex.js';

export function resolveEngine(name: string): Engine {
  switch (name) {
    case 'claude-code':
      return new ClaudeCodeEngine();
    case 'kimi-code':
      return new KimiCodeEngine();
    case 'opencode':
      return new OpenCodeEngine();
    case 'codex':
      return new CodexEngine();
    default:
      throw new Error(`Unknown engine: ${String(name).slice(0, 64)}`);
  }
}

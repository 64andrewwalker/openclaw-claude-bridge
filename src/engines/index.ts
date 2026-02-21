import type { Engine } from '../core/engine.js';
import { ClaudeCodeEngine } from './claude-code.js';
import { KimiCodeEngine } from './kimi-code.js';

export function resolveEngine(name: string): Engine {
  switch (name) {
    case 'claude-code':
      return new ClaudeCodeEngine();
    case 'kimi-code':
      return new KimiCodeEngine();
    default:
      throw new Error(`Unknown engine: ${String(name).slice(0, 64)}`);
  }
}

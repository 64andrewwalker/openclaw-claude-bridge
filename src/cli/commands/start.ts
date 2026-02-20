import { Command } from 'commander';
import path from 'node:path';

export function startCommand(): Command {
  return new Command('start')
    .description('Start the daemon runner (watches for new tasks)')
    .option('--runs-dir <path>', 'Runs directory', path.join(process.cwd(), '.runs'))
    .option('--poll-interval <ms>', 'Poll interval in milliseconds', '2000')
    .action(async (opts) => {
      const { Daemon } = await import('../../core/daemon.js');
      const { ClaudeCodeEngine } = await import('../../engines/claude-code.js');

      const engine = new ClaudeCodeEngine();
      const daemon = new Daemon(opts.runsDir, engine, parseInt(opts.pollInterval));

      process.on('SIGINT', async () => { await daemon.stop(); process.exit(0); });
      process.on('SIGTERM', async () => { await daemon.stop(); process.exit(0); });

      await daemon.start();
    });
}

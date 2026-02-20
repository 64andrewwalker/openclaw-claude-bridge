import { Command } from 'commander';
import path from 'node:path';

export function startCommand(): Command {
  return new Command('start')
    .description('Start the daemon runner (watches for new tasks)')
    .option('--runs-dir <path>', 'Runs directory', path.join(process.cwd(), '.runs'))
    .option('--poll-interval <ms>', 'Poll interval in milliseconds', '2000')
    .option('--max-concurrent <n>', 'Maximum concurrent run executions', '4')
    .option('--engine <name>', 'Engine to use', 'claude-code')
    .action(async (opts) => {
      const { Daemon } = await import('../../core/daemon.js');
      const { resolveEngine } = await import('../../engines/index.js');

      const engine = resolveEngine(opts.engine);
      const daemon = new Daemon(opts.runsDir, engine, parseInt(opts.pollInterval), parseInt(opts.maxConcurrent));

      process.on('SIGINT', async () => { await daemon.stop(); process.exit(0); });
      process.on('SIGTERM', async () => { await daemon.stop(); process.exit(0); });

      await daemon.start();
    });
}

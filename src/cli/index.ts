import { Command } from 'commander';
import { submitCommand } from './commands/submit.js';
import { statusCommand } from './commands/status.js';
import { resumeCommand } from './commands/resume.js';
import { stopCommand } from './commands/stop.js';
import { logsCommand } from './commands/logs.js';
import { doctorCommand } from './commands/doctor.js';

const program = new Command();
program
  .name('codebridge')
  .description('CLI bridge for delegating coding tasks to AI engines')
  .version('0.1.0');

program.addCommand(submitCommand());
program.addCommand(statusCommand());
program.addCommand(resumeCommand());
program.addCommand(stopCommand());
program.addCommand(logsCommand());
program.addCommand(doctorCommand());

program.parse();

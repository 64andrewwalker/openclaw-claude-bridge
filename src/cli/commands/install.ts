import { Command } from 'commander';
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function installCommand(): Command {
  return new Command('install')
    .description('Build, link globally, and generate install guide')
    .action(async () => {
      const __dirname = path.dirname(fileURLToPath(import.meta.url));
      const projectRoot = path.resolve(__dirname, '..', '..', '..');

      // Build and link
      try {
        process.stderr.write('Building...\n');
        execSync('npm run build', { cwd: projectRoot, stdio: 'inherit' });
      } catch {
        process.stderr.write('Build failed. Check TypeScript errors above.\n');
        process.exit(1);
      }
      try {
        process.stderr.write('Linking globally...\n');
        execSync('npm link', { cwd: projectRoot, stdio: 'inherit' });
      } catch {
        process.stderr.write('npm link failed. You may need sudo or to configure npm prefix.\n');
        process.exit(1);
      }

      // Gather info
      let binaryPath = 'codebridge';
      try {
        binaryPath = execSync('which codebridge', { encoding: 'utf-8' }).trim();
      } catch { /* keep default */ }

      let doctorOutput = '';
      try {
        doctorOutput = execSync('codebridge doctor', { encoding: 'utf-8', cwd: projectRoot }).trim();
      } catch { /* skip */ }

      const skillPath = path.join(projectRoot, 'skill', 'codebridge', 'SKILL.md');

      const md = `# CodeBridge Installation Guide

## Binary

\`\`\`
${binaryPath}
\`\`\`

## Environment Check

\`\`\`json
${doctorOutput}
\`\`\`

## Skill Registration (Claude Code)

Add this path to your Claude Code skill configuration:

\`\`\`
${skillPath}
\`\`\`

## Quick Usage

\`\`\`bash
# Submit a task (synchronous)
codebridge submit \\
  --intent coding \\
  --workspace /path/to/project \\
  --message "Implement feature X" \\
  --engine claude-code \\
  --wait \\
  --timeout 120000

# Check environment
codebridge doctor

# View task status
codebridge status <run_id>

# Resume a session
codebridge resume <run_id> --message "Follow up" --wait
\`\`\`

## Available Engines

- \`claude-code\` — Claude Code CLI
- \`kimi-code\` — Kimi Code CLI
- \`opencode\` — OpenCode CLI
- \`codex\` — OpenAI Codex CLI
`;

      const outputPath = '/tmp/codebridge-install.md';
      writeFileSync(outputPath, md);
      process.stdout.write(outputPath + '\n');
    });
}

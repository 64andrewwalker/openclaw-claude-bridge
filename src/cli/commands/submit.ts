import { Command } from "commander";
import { RunManager } from "../../core/run-manager.js";
import { validateRequest } from "../../schemas/request.js";
import path from "node:path";

export function submitCommand(): Command {
  return new Command("submit")
    .description("Submit a new coding task")
    .requiredOption(
      "--intent <type>",
      "Task intent: coding, refactor, debug, ops",
    )
    .requiredOption("--workspace <path>", "Workspace directory path")
    .requiredOption("--message <text>", "Task description / prompt")
    .option("--engine <name>", "Engine to use", "claude-code")
    .option("--model <name>", "Model to use (engine-specific)")
    .option("--wait", "Block until task completes", false)
    .option("--timeout <ms>", "Timeout in milliseconds", "1800000")
    .option(
      "--runs-dir <path>",
      "Runs directory",
      path.join(process.cwd(), ".runs"),
    )
    .action(async (opts) => {
      const timeoutMs = parseInt(opts.timeout, 10);
      const requestInput = {
        task_id: `task-${Date.now()}`,
        intent: opts.intent,
        workspace_path: path.resolve(opts.workspace),
        message: opts.message,
        engine: opts.engine,
        mode: "new",
        constraints: { timeout_ms: timeoutMs, allow_network: true },
        ...(opts.model ? { model: opts.model } : {}),
      };
      const validation = validateRequest(requestInput);
      if (!validation.success) {
        const issues = validation.error.issues.map((i) => {
          const field = i.path.join(".");
          return `  ${field}: ${i.message}`;
        });
        process.stderr.write(
          `Error: invalid submit arguments:\n${issues.join("\n")}\n`,
        );
        process.exit(1);
      }
      const runManager = new RunManager(opts.runsDir);
      const runId = await runManager.createRun(validation.data);

      if (!opts.wait) {
        process.stdout.write(
          JSON.stringify(
            {
              run_id: runId,
              status: "created",
              created_at: new Date().toISOString(),
            },
            null,
            2,
          ) + "\n",
        );
        return;
      }

      // --wait mode
      const { SessionManager } = await import("../../core/session-manager.js");
      const { resolveEngine } = await import("../../engines/index.js");
      const { TaskRunner } = await import("../../core/runner.js");
      const sessionManager = new SessionManager(runManager);
      const engine = resolveEngine(opts.engine);
      const runner = new TaskRunner(runManager, sessionManager, engine);
      await runner.processRun(runId);
      const { readFileSync } = await import("node:fs");
      const result = readFileSync(
        path.join(opts.runsDir, runId, "result.json"),
        "utf-8",
      );
      process.stdout.write(result + "\n");
    });
}

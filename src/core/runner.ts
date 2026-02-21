import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import type { RunManager } from "./run-manager.js";
import type { SessionManager } from "./session-manager.js";
import type { Engine } from "./engine.js";
import { makeError } from "../schemas/errors.js";
import { validateRequest } from "../schemas/request.js";

export type EngineResolver = (name: string) => Engine;

export class TaskRunner {
  private engineResolver: EngineResolver;

  constructor(
    private runManager: RunManager,
    private sessionManager: SessionManager,
    engineOrResolver: Engine | EngineResolver,
  ) {
    // Support both legacy Engine injection and new resolver function
    this.engineResolver =
      typeof engineOrResolver === "function"
        ? engineOrResolver
        : () => engineOrResolver;
  }

  async processRun(runId: string): Promise<void> {
    const startTime = Date.now();

    try {
      const request = await this.runManager.consumeRequest(runId);

      if (!request) {
        await this.fail(
          runId,
          startTime,
          makeError("REQUEST_INVALID", "No request.json found"),
        );
        return;
      }

      // Validate request against schema
      const validation = validateRequest(request);
      if (!validation.success) {
        await this.fail(
          runId,
          startTime,
          makeError("REQUEST_INVALID", validation.error.message),
        );
        return;
      }

      // Security: resolve workspace via realpathSync (follows symlinks) before
      // checking against allowed_roots.  Fall back to a WORKSPACE_NOT_FOUND
      // failure for paths that don't exist yet (realpathSync requires existence).
      let resolvedWorkspace: string;
      try {
        resolvedWorkspace = fs.realpathSync(request.workspace_path);
      } catch {
        await this.fail(
          runId,
          startTime,
          makeError(
            "WORKSPACE_NOT_FOUND",
            `Workspace not found: ${request.workspace_path}`,
          ),
        );
        return;
      }

      if (request.allowed_roots && request.allowed_roots.length > 0) {
        // Use realpathSync for roots too so symlinks in allowed_roots are resolved
        // consistently with the workspace resolution above. Fall back to
        // path.resolve for any root that does not exist on disk yet.
        const resolvedRoots = request.allowed_roots.map((r) => {
          try {
            return fs.realpathSync(r);
          } catch {
            return path.resolve(r);
          }
        });
        const hasFilesystemRoot = resolvedRoots.some((r) => r === path.sep);
        if (hasFilesystemRoot) {
          await this.fail(
            runId,
            startTime,
            makeError(
              "WORKSPACE_INVALID",
              "Filesystem root is not permitted as an allowed_root",
            ),
          );
          return;
        }
        const isAllowed = resolvedRoots.some(
          (resolvedRoot) =>
            resolvedWorkspace === resolvedRoot ||
            resolvedWorkspace.startsWith(resolvedRoot + path.sep),
        );
        if (!isAllowed) {
          await this.fail(
            runId,
            startTime,
            makeError(
              "WORKSPACE_INVALID",
              `Workspace ${resolvedWorkspace} is outside allowed roots: ${request.allowed_roots.join(", ")}`,
            ),
          );
          return;
        }
      }

      // Validate workspace is a directory (realpathSync already verified existence above)
      if (!fs.statSync(resolvedWorkspace).isDirectory()) {
        await this.fail(
          runId,
          startTime,
          makeError(
            "WORKSPACE_NOT_FOUND",
            `Workspace is not a directory: ${request.workspace_path}`,
          ),
        );
        return;
      }

      // Validate resume mode has a session_id — null session_id with resume
      // would silently fall through to engine.start() and start a new task.
      if (request.mode === "resume" && !request.session_id) {
        await this.fail(
          runId,
          startTime,
          makeError(
            "REQUEST_INVALID",
            "resume mode requires a non-null session_id",
          ),
        );
        return;
      }

      // Resolve the correct engine for this request
      const engine = this.engineResolver(request.engine ?? "claude-code");

      // Execute via engine
      const engineResponse = await (async () => {
        if (request.mode === "resume" && request.session_id) {
          await this.sessionManager.transition(runId, "running", {
            session_id: request.session_id,
          });
          return engine.send(request.session_id, request.message, {
            timeoutMs: request.constraints?.timeout_ms,
            cwd: request.workspace_path,
          });
        } else {
          await this.sessionManager.transition(runId, "running");
          return engine.start(request);
        }
      })();

      // Update session with pid/session_id from engine
      if (engineResponse.pid) {
        await this.runManager.updateSession(runId, {
          pid: engineResponse.pid,
          session_id: engineResponse.sessionId ?? undefined,
        });
      }

      const durationMs = Date.now() - startTime;

      if (engineResponse.error) {
        await this.fail(runId, startTime, engineResponse.error, engineResponse);
        return;
      }

      // Success — write output.txt BEFORE result.json (invariant: result.json is completion signal)
      const SUMMARY_LIMIT = 4000;
      const output = engineResponse.output;
      const summaryTruncated = output.length > SUMMARY_LIMIT;
      const summary = summaryTruncated ? output.slice(0, SUMMARY_LIMIT) : output;

      try {
        this.runManager.writeOutputFile(runId, output);
      } catch (e) {
        await this.fail(
          runId,
          startTime,
          makeError(
            "OUTPUT_WRITE_FAILED",
            `Failed to write output.txt: ${e instanceof Error ? e.message : String(e)}`,
          ),
          engineResponse,
        );
        return;
      }

      await this.sessionManager.transition(runId, "completed");
      const outputAbsPath = path.join(
        this.runManager.getRunDir(runId),
        "output.txt",
      );
      await this.runManager.writeResult(runId, {
        run_id: runId,
        status: "completed",
        summary,
        summary_truncated: summaryTruncated,
        output_path: outputAbsPath,
        session_id: engineResponse.sessionId ?? null,
        artifacts: [],
        duration_ms: durationMs,
        token_usage: engineResponse.tokenUsage ?? null,
        files_changed: getFilesChanged(request.workspace_path),
      });
    } catch (e) {
      // Top-level catch: ensures result.json is ALWAYS written as the completion signal
      await this.fail(
        runId,
        startTime,
        makeError(
          "ENGINE_CRASH",
          `Unexpected error: ${e instanceof Error ? e.message : String(e)}`,
        ),
      );
    }
  }

  private async fail(
    runId: string,
    startTime: number,
    error: { code: string; message: string; retryable: boolean },
    engineResponse?: {
      output?: string;
      sessionId?: string | null;
      tokenUsage?: unknown;
    },
  ): Promise<void> {
    try {
      const session = await this.sessionManager.getSession(runId);
      if (session.state !== "failed" && session.state !== "completed") {
        if (session.state === "created") {
          await this.sessionManager.transition(runId, "running");
        }
        await this.sessionManager.transition(runId, "failed");
      }
    } catch {
      /* best effort */
    }

    await this.runManager.writeResult(runId, {
      run_id: runId,
      status: "failed",
      summary: error.message,
      summary_truncated: false,
      output_path: null,
      session_id: engineResponse?.sessionId ?? null,
      artifacts: [],
      duration_ms: Date.now() - startTime,
      token_usage: null,
      files_changed: null,
      error,
    });
  }
}

function getFilesChanged(cwd: string): string[] | null {
  try {
    const modified = execSync("git diff --name-only HEAD", {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    const untracked = execSync("git ls-files --others --exclude-standard", {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    const all = [...modified.split("\n"), ...untracked.split("\n")].filter(
      (f) => f && !f.startsWith(".runs/"),
    );
    return [...new Set(all)];
  } catch {
    return null;
  }
}

import { z } from "zod";

export const SessionSchema = z.object({
  run_id: z.string().min(1),
  engine: z
    .enum(["claude-code", "kimi-code", "opencode", "codex"])
    .default("claude-code"),
  session_id: z.string().nullable().default(null),
  state: z.enum(["created", "running", "stopping", "completed", "failed"]),
  pid: z.number().int().positive().nullable().default(null),
  created_at: z.string().datetime(),
  last_active_at: z.string().datetime(),
});

export type Session = z.infer<typeof SessionSchema>;

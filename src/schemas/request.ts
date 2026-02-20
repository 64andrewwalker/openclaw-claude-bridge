import { z } from 'zod';
import path from 'node:path';

const DANGEROUS_ROOTS = ['/', '/etc', '/usr', '/System', '/bin', '/sbin', '/var'];

export const RequestSchema = z.object({
  task_id: z.string().min(1),
  intent: z.enum(['coding', 'refactor', 'debug', 'ops']),
  workspace_path: z.string().min(1).refine(
    (p) => !DANGEROUS_ROOTS.includes(path.resolve(p)),
    { message: 'Workspace path is a disallowed root path' }
  ),
  message: z.string().min(1),
  engine: z.string().default('claude-code'),
  mode: z.enum(['new', 'resume']).default('new'),
  session_id: z.string().nullable().default(null),
  constraints: z.object({
    timeout_ms: z.number().positive().default(1800000),
    allow_network: z.boolean().default(true),
  }).default({ timeout_ms: 1800000, allow_network: true }),
  allowed_roots: z.array(z.string()).optional(),
});

export type TaskRequest = z.infer<typeof RequestSchema>;

export function validateRequest(input: unknown) {
  return RequestSchema.safeParse(input);
}

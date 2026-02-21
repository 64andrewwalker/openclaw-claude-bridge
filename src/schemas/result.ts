import { z } from 'zod';

const ErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  retryable: z.boolean(),
  suggestion: z.string().optional(),
});

const TokenUsageSchema = z.object({
  prompt_tokens: z.number(),
  completion_tokens: z.number(),
  total_tokens: z.number(),
}).nullable();

export const ResultSchema = z.object({
  run_id: z.string().min(1),
  status: z.enum(['completed', 'failed']),
  summary: z.string(),
  session_id: z.string().nullable(),
  artifacts: z.array(z.string()),
  duration_ms: z.number(),
  token_usage: TokenUsageSchema,
  files_changed: z.array(z.string()).nullable().default(null),
  error: ErrorSchema.optional(),
}).refine(
  (data) => data.status !== 'failed' || data.error !== undefined,
  { message: 'error is required when status is failed', path: ['error'] }
);

export type TaskResult = z.infer<typeof ResultSchema>;

export function validateResult(input: unknown) {
  return ResultSchema.safeParse(input);
}

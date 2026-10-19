import type { z } from 'zod';
import { ApiError } from './errors.js';

function parse<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw new ApiError(400, 'VALIDATION_FAILED', 'Validation failed', {
    issues: result.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message })),
  });
}

export function parseBody<S extends z.ZodType>(schema: S, body: unknown): z.infer<S> {
  return parse(schema, body);
}

export function parseQuery<S extends z.ZodType>(schema: S, query: unknown): z.infer<S> {
  return parse(schema, query);
}

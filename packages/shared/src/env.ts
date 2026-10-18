import type { z } from 'zod';

export class EnvValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Invalid environment: ${issues.join(', ')}`);
    this.name = 'EnvValidationError';
    this.issues = issues;
  }
}

/** Validates env against a zod schema. Error messages name variables only, never values. */
export function loadEnv<S extends z.ZodType>(schema: S, env: NodeJS.ProcessEnv = process.env): z.infer<S> {
  const result = schema.safeParse(env);
  if (result.success) return result.data;

  const issues: string[] = [];
  for (const issue of result.error.issues) {
    const name = issue.path.length > 0 ? issue.path.map(String).join('.') : '(root)';
    const first = issue.path[0];
    const missing = typeof first === 'string' && env[first] === undefined;
    let reason: string;
    if (missing) reason = 'required';
    else if (issue.code === 'invalid_type') reason = `expected ${String(issue.expected)}`;
    else reason = issue.code.replaceAll('_', ' ');
    const entry = `${name} (${reason})`;
    if (!issues.includes(entry)) issues.push(entry);
  }
  throw new EnvValidationError(issues);
}

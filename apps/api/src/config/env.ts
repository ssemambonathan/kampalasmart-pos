import { z } from 'zod';

const optionalString = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
  z.string().optional(),
);

const booleanFromEnv = (defaultValue: boolean) =>
  z.preprocess((v) => {
    if (v === undefined || v === null || v === '') return defaultValue;
    if (typeof v === 'boolean') return v;
    if (v === 'true' || v === '1') return true;
    if (v === 'false' || v === '0') return false;
    return v;
  }, z.boolean());

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: optionalString,
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(7),
  REMEMBER_ME_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  COOKIE_SECURE: booleanFromEnv(false),
  COOKIE_DOMAIN: optionalString,
  EMAIL_PROVIDER: optionalString,
  LOGIN_RATE_LIMIT: z.coerce.number().int().positive().default(8),
  LOGIN_RATE_WINDOW_SECONDS: z.coerce.number().int().positive().default(900),
  TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(0),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration — ${issues}`);
  }
  return parsed.data;
}

export function currentEnv(): Env {
  return validateEnv(process.env);
}

import { z } from 'zod';

/**
 * Every environment variable the API reads, validated at boot so a
 * misconfiguration fails immediately instead of at the first request.
 * Mirrored by .env.example at the repository root.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  /** Comma-separated list; the web dev server is allowed by default. */
  CORS_ORIGINS: z.string().default('http://localhost:5173'),

  /**
   * `filesystem` keeps everything in ./.data and needs no external services, so
   * the app runs with a single command. `postgres` uses Prisma.
   */
  STORAGE_DRIVER: z.enum(['filesystem', 'postgres']).default('filesystem'),
  DATA_DIR: z.string().default('./.data'),
  DATABASE_URL: z.string().optional(),

  /** `local` writes to disk and signs URLs with ASSET_URL_SECRET. */
  ASSET_STORE: z.enum(['local', 's3']).default('local'),
  ASSET_DIR: z.string().default('./.storage'),
  ASSET_URL_SECRET: z.string().min(16).default('dev-only-change-me-in-production'),
  ASSET_URL_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),

  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(25 * 1024 * 1024),

  /** `inline` runs jobs in-process; `bullmq` needs REDIS_URL. */
  QUEUE_DRIVER: z.enum(['inline', 'bullmq']).default('inline'),
  REDIS_URL: z.string().optional(),

  /** Server-side only. Never sent to the browser. */
  FIGMA_ACCESS_TOKEN: z.string().optional(),

  AI_PROVIDER: z.enum(['none', 'openai']).default('none'),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),
  /**
   * Hard gate on sending user artwork to a third party. Even with a key
   * present, nothing leaves this process unless this is explicitly true
   * (spec section 27).
   */
  AI_ALLOW_SOURCE_UPLOAD: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),

  RATE_LIMIT_TTL_SECONDS: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_LIMIT: z.coerce.number().int().positive().default(120),
  /** Tighter budget for the expensive analyse/render/validate endpoints. */
  RATE_LIMIT_EXPENSIVE_LIMIT: z.coerce.number().int().positive().default(20),

  LOG_LEVEL: z.enum(['debug', 'log', 'warn', 'error']).default('log'),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
  OTEL_SERVICE_NAME: z.string().default('dae-api'),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  const env = parsed.data;

  if (env.STORAGE_DRIVER === 'postgres' && !env.DATABASE_URL) {
    throw new Error('STORAGE_DRIVER=postgres requires DATABASE_URL');
  }
  if (env.QUEUE_DRIVER === 'bullmq' && !env.REDIS_URL) {
    throw new Error('QUEUE_DRIVER=bullmq requires REDIS_URL');
  }
  if (env.ASSET_STORE === 's3' && !(env.S3_BUCKET && env.S3_REGION)) {
    throw new Error('ASSET_STORE=s3 requires S3_BUCKET and S3_REGION');
  }
  if (env.AI_PROVIDER === 'openai' && !env.OPENAI_API_KEY) {
    throw new Error('AI_PROVIDER=openai requires OPENAI_API_KEY');
  }
  if (env.NODE_ENV === 'production' && env.ASSET_URL_SECRET === 'dev-only-change-me-in-production') {
    throw new Error('ASSET_URL_SECRET must be set to a real secret in production');
  }

  cached = env;
  return env;
}

export const ENV = 'ENV';

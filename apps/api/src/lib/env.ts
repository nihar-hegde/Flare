import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: z.coerce.number().default(8080),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  INGEST_API_KEY: z.string().optional(),

  // GitHub context sync (MVP token-based flow, OAuth later).
  GITHUB_TOKEN: z.string().optional(),
  GITHUB_OWNER: z.string().optional(),
  GITHUB_REPO: z.string().optional(),
  GITHUB_DEFAULT_BRANCH: z.string().default("main"),
  // GitHub write actions (comment on the suspect PR / open a regression issue).
  // Off by default; requires a token with `issues:write` + `pull-requests:write`.
  GITHUB_WRITE_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),

  // Incident handling.
  // A successful investigation is NOT re-run just because the same error happens
  // again (that's the whole point — one investigation per error, not per event).
  // This cooldown only rate-limits *retries of a FAILED* investigation, so a
  // persistently failing run can't drain AI credits. The manual "Investigate"
  // action always bypasses it. Set to 0 to retry a failed run on the next event.
  REINVESTIGATE_COOLDOWN_SECONDS: z.coerce.number().int().nonnegative().default(600),

  // Database (Supabase / Postgres via Drizzle)
  DATABASE_URL: z.string().url(),

  // AI engine (Vercel AI SDK). Only the active provider's key is required.
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().optional(),
  INVESTIGATOR_MODEL: z.string().default("openai:gpt-4o"),
  SUMMARIZER_MODEL: z.string().default("openai:gpt-4o-mini"),
});

export type Env = z.infer<typeof envSchema>;

function validateEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    console.error(
      "Invalid environment variables:",
      parsed.error.flatten().fieldErrors,
    );
    process.exit(1);
  }

  return parsed.data;
}

export const env = validateEnv();

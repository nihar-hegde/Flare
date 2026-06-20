import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: z.coerce.number().default(8080),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  INGEST_API_KEY: z.string().optional(),

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

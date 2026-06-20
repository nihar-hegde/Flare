function numberEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stringEnv(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

export const env = {
  PORT: numberEnv("PORT", 4000),
  FLARE_ENDPOINT: stringEnv("FLARE_ENDPOINT", "http://localhost:8080/api/ingest"),
  FLARE_INGEST_API_KEY: stringEnv(
    "FLARE_INGEST_API_KEY",
    "dev-flare-ingest-key",
  ),
  FLARE_SERVICE: stringEnv("FLARE_SERVICE", "demo-payments-api"),
  FLARE_ENVIRONMENT: stringEnv("FLARE_ENVIRONMENT", "development"),
  FLARE_RELEASE_VERSION: stringEnv("FLARE_RELEASE_VERSION", "v0.1.0"),
};

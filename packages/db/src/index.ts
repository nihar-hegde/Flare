import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. The importing process must load it (the API loads apps/api/.env via dotenv).",
  );
}

// `prepare: false` keeps us compatible with Supabase's transaction pooler
// (port 6543); it is harmless on the direct connection too.
const client = postgres(connectionString, { prepare: false });

export const db = drizzle(client, { schema });

export { schema };
export * from "./schema.js";

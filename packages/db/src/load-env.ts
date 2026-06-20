// Side-effect module: loads apps/api/.env into process.env.
// Import this FIRST (before ./index.js) in standalone scripts like the seeder,
// since ESM evaluates imports in source order.
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(here, "../../../apps/api/.env") });

import { Hono } from "hono";
import type { AppEnv } from "../types/index.js";
import { githubRoutes } from "./github.js";
import { healthRoutes } from "./health.js";
import { ingestRoutes } from "./ingest.js";
import { incidentsRoutes } from "./incidents.js";

export const routes = new Hono<AppEnv>()
  .route("/health", healthRoutes)
  .route("/github", githubRoutes)
  .route("/ingest", ingestRoutes)
  .route("/incidents", incidentsRoutes);

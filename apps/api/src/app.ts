import { Hono } from "hono";
import { logger } from "hono/logger";
import { requestId } from "hono/request-id";
import type { AppEnv } from "./types/index.js";
import { corsMiddleware } from "./middleware/cors.js";
import { errorHandler } from "./middleware/error-handler.js";
import { routes } from "./routes/index.js";

// Build the app via chaining so the route schema is preserved on the exported
// value — this lets the web app derive a fully typed RPC client from AppType.
const app = new Hono<AppEnv>()
  // Global middleware
  .use("*", requestId())
  .use("*", logger())
  .use("*", corsMiddleware)
  // Root health check route
  .get("/", (c) => c.text("Flare API server is active! 🚀"))
  // Error + not-found handlers
  .onError(errorHandler)
  .notFound((c) => c.json({ success: false, error: "Not Found" }, 404))
  // Mount all routes under /api
  .route("/api", routes);

export type AppType = typeof app;

export default app;

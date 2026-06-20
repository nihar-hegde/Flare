import { Hono } from "hono";
import type { AppEnv } from "../types/index.js";

export const healthRoutes = new Hono<AppEnv>().get("/", (c) => {
  return c.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

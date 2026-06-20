import { Hono } from "hono";
import { verifySharedApiKey } from "../lib/shared-api-key.js";
import { CURRENT_ORG_ID } from "../lib/tenant.js";
import {
  getGithubSyncStatus,
  syncGithubRepo,
} from "../services/github-sync.js";
import type { AppEnv } from "../types/index.js";

export const githubRoutes = new Hono<AppEnv>()
  .get("/status", async (c) => {
    const status = await getGithubSyncStatus(CURRENT_ORG_ID);
    return c.json({ data: status });
  })
  .post("/sync", async (c) => {
    verifySharedApiKey({
      authorization: c.req.header("authorization"),
      apiKey: c.req.header("x-flare-api-key"),
    });

    const result = await syncGithubRepo(CURRENT_ORG_ID);
    return c.json({ data: result });
  });

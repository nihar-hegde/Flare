import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { CURRENT_ORG_ID } from "../lib/tenant.js";
import { AppError } from "../middleware/error-handler.js";
import {
  serializeIncidentDetail,
  serializeIncidentListItem,
} from "../serializers/incidents.js";
import { getIncidentById, listIncidents } from "../services/incidents.js";
import {
  processInvestigation,
  startInvestigation,
} from "../services/investigations.js";
import type { AppEnv } from "../types/index.js";

const incidentParams = z.object({ id: z.string().uuid() });

export const incidentsRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const rows = await listIncidents(CURRENT_ORG_ID);
    return c.json({ data: rows.map(serializeIncidentListItem) });
  })
  .get("/:id", zValidator("param", incidentParams), async (c) => {
    const { id } = c.req.valid("param");
    const incident = await getIncidentById(CURRENT_ORG_ID, id);

    if (!incident) {
      throw new AppError(404, "Incident not found");
    }

    return c.json({ data: serializeIncidentDetail(incident) });
  })
  // Kick off (or re-run) the AI investigation. Fast-acks with the new
  // investigation's id while the agent runs in the background; the dashboard
  // reflects progress via polling / realtime.
  .post("/:id/investigate", zValidator("param", incidentParams), async (c) => {
    const { id } = c.req.valid("param");
    const incident = await getIncidentById(CURRENT_ORG_ID, id);

    if (!incident) {
      throw new AppError(404, "Incident not found");
    }

    const investigation = await startInvestigation(id);

    void processInvestigation(CURRENT_ORG_ID, id, investigation.id).catch(
      (err) => {
        console.error("[investigate] background task crashed:", err);
      },
    );

    return c.json(
      { data: { investigationId: investigation.id, status: investigation.status } },
      202,
    );
  });

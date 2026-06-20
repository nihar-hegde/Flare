import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { verifySharedApiKey } from "../lib/shared-api-key.js";
import { CURRENT_ORG_ID } from "../lib/tenant.js";
import { ingestIncident } from "../services/ingest.js";
import {
  processInvestigation,
  startInvestigation,
} from "../services/investigations.js";
import type { AppEnv } from "../types/index.js";

const severitySchema = z.enum(["critical", "high", "medium", "low"]);

const stackFrameSchema = z.object({
  filename: z.string().trim().min(1),
  function: z.string().trim().min(1).optional(),
  lineno: z.coerce.number().int().positive().optional(),
  colno: z.coerce.number().int().positive().optional(),
  inApp: z.boolean().optional(),
  context: z.string().optional(),
});

const exceptionSchema = z.object({
  type: z.string().trim().min(1).optional(),
  message: z.string().trim().min(1),
  stack: z.string().optional(),
  handled: z.boolean().optional(),
  mechanism: z.string().trim().min(1).optional(),
  values: z
    .array(
      z.object({
        type: z.string().trim().min(1).optional(),
        message: z.string().trim().min(1),
        stack: z.string().optional(),
      }),
    )
    .optional(),
});

const requestSchema = z.object({
  method: z.string().trim().min(1).optional(),
  url: z.string().trim().min(1).optional(),
  route: z.string().trim().min(1).optional(),
  path: z.string().trim().min(1).optional(),
  query: z.record(z.unknown()).optional(),
  headers: z.record(z.union([z.string(), z.array(z.string())])).optional(),
  ip: z.string().trim().min(1).optional(),
  userAgent: z.string().trim().min(1).optional(),
  statusCode: z.coerce.number().int().positive().optional(),
});

const traceSchema = z.object({
  traceId: z.string().trim().min(1).optional(),
  spanId: z.string().trim().min(1).optional(),
  parentSpanId: z.string().trim().min(1).optional(),
  traceparent: z.string().trim().min(1).optional(),
});

const breadcrumbSchema = z.object({
  timestamp: z.coerce.date().optional(),
  category: z.string().trim().min(1).optional(),
  message: z.string().trim().min(1).optional(),
  level: z
    .enum(["debug", "info", "warning", "error", "fatal"])
    .optional(),
  data: z.record(z.unknown()).optional(),
});

const spanSchema = z.object({
  name: z.string().trim().min(1),
  op: z.string().trim().min(1).optional(),
  traceId: z.string().trim().min(1).optional(),
  spanId: z.string().trim().min(1).optional(),
  parentSpanId: z.string().trim().min(1).optional(),
  startTime: z.coerce.date().optional(),
  endTime: z.coerce.date().optional(),
  durationMs: z.coerce.number().nonnegative().optional(),
  status: z.string().trim().min(1).optional(),
  attributes: z.record(z.unknown()).optional(),
});

const ingestPayloadSchema = z.object({
  source: z.string().trim().min(1).optional(),
  externalId: z.string().trim().min(1).optional(),
  fingerprint: z.string().trim().min(1).optional(),
  title: z.string().trim().min(1).optional(),
  service: z.string().trim().min(1),
  environment: z.string().trim().min(1).default("production"),
  releaseVersion: z.string().trim().min(1).optional(),
  errorType: z.string().trim().min(1).optional(),
  errorMessage: z.string().trim().min(1),
  culprit: z.string().trim().min(1).optional(),
  severity: severitySchema.default("high"),
  affectedUsers: z.coerce.number().int().nonnegative().optional(),
  permalink: z.string().url().optional(),
  occurredAt: z.coerce.date().optional(),
  stackTrace: z.array(stackFrameSchema).default([]),
  exception: exceptionSchema.optional(),
  request: requestSchema.optional(),
  trace: traceSchema.optional(),
  breadcrumbs: z.array(breadcrumbSchema).max(100).optional(),
  spans: z.array(spanSchema).max(100).optional(),
  contexts: z.record(z.unknown()).optional(),
  tags: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
  user: z.record(z.unknown()).optional(),
  extra: z.record(z.unknown()).optional(),
  raw: z.record(z.unknown()).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const ingestRoutes = new Hono<AppEnv>().post(
  "/",
  zValidator("json", ingestPayloadSchema),
  async (c) => {
    verifySharedApiKey({
      authorization: c.req.header("authorization"),
      apiKey: c.req.header("x-flare-api-key"),
    });

    const payload = c.req.valid("json");
    const result = await ingestIncident(CURRENT_ORG_ID, payload);
    let investigationId: string | null = null;

    if (result.shouldInvestigate) {
      const investigation = await startInvestigation(result.incident.id);
      investigationId = investigation.id;

      void processInvestigation(
        CURRENT_ORG_ID,
        result.incident.id,
        investigation.id,
      ).catch((err) => {
        console.error("[ingest] background investigation crashed:", err);
      });
    }

    return c.json(
      {
        data: {
          incidentId: result.incident.id,
          eventId: result.eventId,
          created: result.created,
          investigationId,
        },
      },
      202,
    );
  },
);

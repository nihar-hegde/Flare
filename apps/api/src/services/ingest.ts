import { createHash } from "node:crypto";
import { and, desc, eq, ne, or, sql } from "drizzle-orm";
import {
  activityLog,
  db,
  events,
  incidents,
  type Incident,
  type StackFrame,
} from "@repo/db";

type Severity = Incident["severity"];
type JsonRecord = Record<string, unknown>;

export type BreadcrumbLevel = "debug" | "info" | "warning" | "error" | "fatal";

export interface IngestException {
  type?: string;
  message: string;
  stack?: string;
  handled?: boolean;
  mechanism?: string;
  values?: Array<{
    type?: string;
    message: string;
    stack?: string;
  }>;
}

export interface IngestRequestContext {
  method?: string;
  url?: string;
  route?: string;
  path?: string;
  query?: JsonRecord;
  headers?: Record<string, string | string[]>;
  ip?: string;
  userAgent?: string;
  statusCode?: number;
}

export interface IngestTraceContext {
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  traceparent?: string;
}

export interface IngestBreadcrumb {
  timestamp?: Date;
  category?: string;
  message?: string;
  level?: BreadcrumbLevel;
  data?: JsonRecord;
}

export interface IngestSpan {
  name: string;
  op?: string;
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  startTime?: Date;
  endTime?: Date;
  durationMs?: number;
  status?: string;
  attributes?: JsonRecord;
}

export interface IngestIncidentInput {
  source?: string;
  externalId?: string;
  fingerprint?: string;
  title?: string;
  service: string;
  environment: string;
  releaseVersion?: string;
  errorType?: string;
  errorMessage: string;
  culprit?: string;
  severity: Severity;
  affectedUsers?: number;
  permalink?: string;
  occurredAt?: Date;
  stackTrace: StackFrame[];
  exception?: IngestException;
  request?: IngestRequestContext;
  trace?: IngestTraceContext;
  breadcrumbs?: IngestBreadcrumb[];
  spans?: IngestSpan[];
  contexts?: JsonRecord;
  tags?: Record<string, string | number | boolean | null>;
  user?: JsonRecord;
  extra?: JsonRecord;
  raw?: JsonRecord;
  metadata?: JsonRecord;
}

export interface IngestIncidentResult {
  incident: Incident;
  eventId: string;
  created: boolean;
  shouldInvestigate: boolean;
}

const SEVERITY_RANK: Record<Severity, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

function maxSeverity(a: Severity, b: Severity): Severity {
  return SEVERITY_RANK[b] > SEVERITY_RANK[a] ? b : a;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 3)}...`;
}

function topApplicationFrame(frames: StackFrame[]): StackFrame | undefined {
  return frames.find((frame) => frame.inApp !== false) ?? frames[0];
}

function normalizeMessage(message: string): string {
  return message
    .toLowerCase()
    .replace(/(['"]).*?\1/g, "$1?$1")
    .replace(/\b[0-9a-f]{8,}\b/g, "#")
    .replace(/\b\d+\b/g, "#")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

export function buildIngestFingerprint(input: {
  service: string;
  environment: string;
  errorType?: string;
  errorMessage: string;
  stackTrace: StackFrame[];
}): string {
  const topFrame = topApplicationFrame(input.stackTrace);
  const parts = [
    input.service,
    input.environment,
    input.errorType ?? "Error",
    normalizeMessage(input.errorMessage),
    topFrame?.filename ?? "unknown-file",
    topFrame?.function ?? "unknown-function",
    topFrame?.lineno ? String(topFrame.lineno) : "unknown-line",
  ];

  return createHash("sha256").update(parts.join("\n")).digest("hex");
}

function buildTitle(input: IngestIncidentInput): string {
  if (input.title) return truncate(input.title, 180);
  const prefix = input.errorType ?? "Error";
  return truncate(`${prefix}: ${input.errorMessage}`, 180);
}

function buildCulprit(input: IngestIncidentInput): string | null {
  if (input.culprit) return truncate(input.culprit, 240);
  const frame = topApplicationFrame(input.stackTrace);
  if (!frame) return null;

  const location = [
    frame.filename,
    frame.lineno ? `:${frame.lineno}` : "",
    frame.colno ? `:${frame.colno}` : "",
  ].join("");

  return frame.function ? `${frame.function} (${location})` : location;
}

function iso(date: Date | undefined): string | undefined {
  return date?.toISOString();
}

function normalizeBreadcrumbs(
  breadcrumbs: IngestBreadcrumb[] | undefined,
): Array<Omit<IngestBreadcrumb, "timestamp"> & { timestamp?: string }> | undefined {
  return breadcrumbs?.map((breadcrumb) => ({
    ...breadcrumb,
    timestamp: iso(breadcrumb.timestamp),
  }));
}

function normalizeSpans(
  spans: IngestSpan[] | undefined,
): Array<Omit<IngestSpan, "startTime" | "endTime"> & {
  startTime?: string;
  endTime?: string;
}> | undefined {
  return spans?.map((span) => ({
    ...span,
    startTime: iso(span.startTime),
    endTime: iso(span.endTime),
  }));
}

function buildRawPayload(input: IngestIncidentInput): JsonRecord {
  return {
    ...(input.raw ?? {}),
    source: input.source ?? "flare-ingest",
    exception: input.exception,
    request: input.request,
    trace: input.trace,
    breadcrumbs: normalizeBreadcrumbs(input.breadcrumbs),
    spans: normalizeSpans(input.spans),
    contexts: input.contexts,
    tags: input.tags,
    user: input.user,
    extra: input.extra,
    metadata: input.metadata ?? {},
    normalized: {
      externalId: input.externalId ?? null,
      service: input.service,
      environment: input.environment,
      releaseVersion: input.releaseVersion ?? null,
      severity: input.severity,
    },
  };
}

/**
 * Store one real error occurrence. Incidents are grouped by a stable fingerprint
 * while every occurrence is preserved as an event for later investigation.
 */
export async function ingestIncident(
  organizationId: string,
  input: IngestIncidentInput,
): Promise<IngestIncidentResult> {
  const fingerprint = input.fingerprint ?? buildIngestFingerprint(input);
  const occurredAt = input.occurredAt ?? new Date();
  const identityMatcher = input.externalId
    ? or(
        eq(incidents.externalId, input.externalId),
        eq(incidents.fingerprint, fingerprint),
      )
    : eq(incidents.fingerprint, fingerprint);

  return db.transaction(async (tx) => {
    const existing = await tx.query.incidents.findFirst({
      where: and(
        eq(incidents.organizationId, organizationId),
        ne(incidents.status, "resolved"),
        ne(incidents.status, "ignored"),
        identityMatcher,
      ),
      orderBy: [desc(incidents.lastSeenAt)],
    });

    const raw = buildRawPayload(input);
    const culprit = buildCulprit(input);

    if (existing) {
      const [incident] = await tx
        .update(incidents)
        .set({
          title: buildTitle(input),
          culprit,
          service: input.service,
          environment: input.environment,
          errorType: input.errorType ?? existing.errorType,
          errorMessage: input.errorMessage,
          severity: maxSeverity(existing.severity, input.severity),
          releaseVersion: input.releaseVersion ?? existing.releaseVersion,
          permalink: input.permalink ?? existing.permalink,
          affectedUsers: input.affectedUsers ?? existing.affectedUsers,
          occurrenceCount: sql`${incidents.occurrenceCount} + 1`,
          lastSeenAt: occurredAt,
        })
        .where(eq(incidents.id, existing.id))
        .returning();

      if (!incident) throw new Error("Failed to update incident");

      const [event] = await tx
        .insert(events)
        .values({
          incidentId: incident.id,
          stackTrace: input.stackTrace,
          raw,
          occurredAt,
        })
        .returning({ id: events.id });

      if (!event) throw new Error("Failed to create event");

      await tx.insert(activityLog).values({
        incidentId: incident.id,
        type: "ingested",
        message: "New occurrence ingested",
        actor: input.source ?? "flare-ingest",
        metadata: { eventId: event.id, created: false },
      });

      return {
        incident,
        eventId: event.id,
        created: false,
        shouldInvestigate: true,
      };
    }

    const [incident] = await tx
      .insert(incidents)
      .values({
        organizationId,
        externalId: input.externalId,
        fingerprint,
        title: buildTitle(input),
        culprit,
        service: input.service,
        environment: input.environment,
        errorType: input.errorType ?? "Error",
        errorMessage: input.errorMessage,
        severity: input.severity,
        status: "open",
        releaseVersion: input.releaseVersion,
        permalink: input.permalink,
        occurrenceCount: 1,
        affectedUsers: input.affectedUsers,
        firstSeenAt: occurredAt,
        lastSeenAt: occurredAt,
      })
      .returning();

    if (!incident) throw new Error("Failed to create incident");

    const [event] = await tx
      .insert(events)
      .values({
        incidentId: incident.id,
        stackTrace: input.stackTrace,
        raw,
        occurredAt,
      })
      .returning({ id: events.id });

    if (!event) throw new Error("Failed to create event");

    await tx.insert(activityLog).values({
      incidentId: incident.id,
      type: "ingested",
      message: "Incident ingested",
      actor: input.source ?? "flare-ingest",
      metadata: { eventId: event.id, created: true },
    });

    return {
      incident,
      eventId: event.id,
      created: true,
      shouldInvestigate: true,
    };
  });
}

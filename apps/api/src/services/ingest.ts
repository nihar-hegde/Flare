import { createHash } from "node:crypto";
import { desc, eq, sql } from "drizzle-orm";
import {
  activityLog,
  db,
  events,
  incidents,
  investigations,
  type Incident,
  type StackFrame,
} from "@repo/db";
import { env } from "../lib/env.js";

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

/**
 * Decide whether a recurring occurrence of an *existing* incident should kick
 * off another investigation. A brand-new incident always investigates (handled
 * by the create path); this only governs repeats, where the default is to record
 * the occurrence WITHOUT spending another AI run:
 *  - no investigation yet → false (the create path owns the first run; don't race it)
 *  - one already queued/running → false (don't pile on)
 *  - last run completed → false (the answer hasn't changed just because it happened
 *    again; a real re-investigation comes from the manual button or a regression,
 *    which opens a fresh incident)
 *  - last run failed → retry, but rate-limited by the cooldown so a persistent
 *    failure can't drain credits
 */
function shouldReinvestigate(
  latest:
    | { status: string; completedAt: Date | null; createdAt: Date }
    | undefined,
  now: number,
  retryCooldownMs: number,
): boolean {
  if (!latest) return false;
  if (latest.status === "pending" || latest.status === "running") return false;
  if (latest.status === "failed") {
    if (retryCooldownMs <= 0) return true;
    const lastAttemptAt = (latest.completedAt ?? latest.createdAt).getTime();
    return now - lastAttemptAt >= retryCooldownMs;
  }
  return false;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 3)}...`;
}

function topApplicationFrame(frames: StackFrame[]): StackFrame | undefined {
  return frames.find((frame) => frame.inApp !== false) ?? frames[0];
}

function normalizeMessage(message: string): string {
  return (
    message
      .toLowerCase()
      .replace(/(['"]).*?\1/g, "$1?$1")
      .replace(/\b[0-9a-f]{8,}\b/g, "#")
      // Collapse any alphanumeric token that contains a digit — ids, ports, IP
      // octets, hashes, `txn_test_312`, etc. `\b\d+\b` missed these because the
      // word boundary never falls between an underscore/letter and a digit, so
      // `txn_test_312` and `txn_test_123` produced different fingerprints and
      // each spawned its own incident.
      .replace(/[\w-]*\d[\w-]*/g, "#")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 240)
  );
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
  const raw = buildRawPayload(input);
  const culprit = buildCulprit(input);

  return db.transaction(async (tx) => {
    // Atomic group-or-create. The partial unique index on
    // (organization_id, fingerprint) WHERE status NOT IN ('resolved','ignored')
    // guarantees at most ONE active incident per error. Under a flood of
    // identical events, exactly one INSERT wins (occurrence_count stays 1) while
    // every other event is serialized into the DO UPDATE branch
    // (occurrence_count += 1). So "did we just create this incident?" is simply
    // "is the returned occurrence_count back at 1?" — no read-then-write race.
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
      .onConflictDoUpdate({
        target: [incidents.organizationId, incidents.fingerprint],
        targetWhere: sql`${incidents.status} not in ('resolved', 'ignored')`,
        set: {
          title: sql`excluded.title`,
          culprit: sql`excluded.culprit`,
          service: sql`excluded.service`,
          environment: sql`excluded.environment`,
          errorType: sql`coalesce(excluded.error_type, ${incidents.errorType})`,
          errorMessage: sql`excluded.error_message`,
          releaseVersion: sql`coalesce(excluded.release_version, ${incidents.releaseVersion})`,
          permalink: sql`coalesce(excluded.permalink, ${incidents.permalink})`,
          affectedUsers: sql`coalesce(excluded.affected_users, ${incidents.affectedUsers})`,
          // Keep the more severe of old vs new (enum order is declaration order,
          // which is inverse to severity, so rank explicitly).
          severity: sql`case
            when (case excluded.severity when 'critical' then 3 when 'high' then 2 when 'medium' then 1 else 0 end)
               > (case ${incidents.severity} when 'critical' then 3 when 'high' then 2 when 'medium' then 1 else 0 end)
            then excluded.severity else ${incidents.severity} end`,
          occurrenceCount: sql`${incidents.occurrenceCount} + 1`,
          lastSeenAt: sql`excluded.last_seen_at`,
        },
      })
      .returning();

    if (!incident) throw new Error("Failed to upsert incident");

    const created = incident.occurrenceCount === 1;

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

    // A brand-new incident always investigates (exactly once). A recurrence only
    // re-investigates under the narrow conditions in `shouldReinvestigate`.
    let shouldInvestigate = true;
    if (!created) {
      const latestInvestigation = await tx.query.investigations.findFirst({
        where: eq(investigations.incidentId, incident.id),
        orderBy: [desc(investigations.createdAt)],
        columns: { status: true, completedAt: true, createdAt: true },
      });
      shouldInvestigate = shouldReinvestigate(
        latestInvestigation,
        Date.now(),
        env.REINVESTIGATE_COOLDOWN_SECONDS * 1000,
      );
    }

    // Only the first occurrence writes a timeline entry. Recurrences are already
    // captured by `occurrenceCount` / `lastSeenAt`; logging one row per event
    // would bloat writes and bury the timeline in "recurrence" noise at scale.
    // A re-investigation triggered by a recurrence still shows up via the
    // investigation lifecycle entries ("investigation_started", etc.).
    if (created) {
      await tx.insert(activityLog).values({
        incidentId: incident.id,
        type: "ingested",
        message: "Incident ingested",
        actor: input.source ?? "flare-ingest",
        metadata: { eventId: event.id, created: true },
      });
    }

    return {
      incident,
      eventId: event.id,
      created,
      shouldInvestigate,
    };
  });
}

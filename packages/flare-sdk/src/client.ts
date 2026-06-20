import {
  addScopedBreadcrumb,
  addScopedSpan,
  getScope,
  mergeScopeContext,
  runWithScope,
} from "./context.js";
import { sanitizeValue } from "./redaction.js";
import { errorToException, normalizeError, parseStackTrace } from "./stacktrace.js";
import type {
  FlareBreadcrumb,
  FlareCaptureContext,
  FlareCaptureResult,
  FlareIngestPayload,
  FlareInitOptions,
  FlareSpan,
  RequestScope,
  Severity,
} from "./types.js";

const DEFAULT_ENDPOINT = "http://localhost:8080/api/ingest";
const DEFAULT_ENVIRONMENT = "production";
const DEFAULT_TIMEOUT_MS = 3_000;
const DEFAULT_MAX_BREADCRUMBS = 50;

interface IngestResponse {
  data?: FlareCaptureResult;
}

export class FlareClient {
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly service: string;
  private readonly environment: string;
  private readonly releaseVersion: string | undefined;
  private readonly enabled: boolean;
  private readonly defaultSeverity: Severity;
  private readonly timeoutMs: number;
  private readonly maxBreadcrumbs: number;
  private readonly beforeSend:
    | ((payload: FlareIngestPayload) => FlareIngestPayload | null)
    | undefined;
  private readonly pending = new Set<Promise<FlareCaptureResult | null>>();
  private readonly globalBreadcrumbs: FlareBreadcrumb[] = [];

  constructor(options: FlareInitOptions) {
    this.endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
    this.apiKey = options.apiKey;
    this.service = options.service;
    this.environment = options.environment ?? DEFAULT_ENVIRONMENT;
    this.releaseVersion = options.releaseVersion;
    this.enabled = options.enabled ?? true;
    this.defaultSeverity = options.defaultSeverity ?? "high";
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxBreadcrumbs = options.maxBreadcrumbs ?? DEFAULT_MAX_BREADCRUMBS;
    this.beforeSend = options.beforeSend;
  }

  captureException(
    error: unknown,
    context: FlareCaptureContext = {},
  ): Promise<FlareCaptureResult | null> {
    if (!this.enabled) return Promise.resolve(null);

    const mergedContext = mergeScopeContext(getScope(), context);
    const payload = this.buildPayload(error, mergedContext);
    const finalPayload = this.beforeSend ? this.beforeSend(payload) : payload;
    if (!finalPayload) return Promise.resolve(null);

    const task = this.send(finalPayload);
    this.pending.add(task);
    void task.finally(() => this.pending.delete(task));
    return task;
  }

  addBreadcrumb(breadcrumb: Omit<FlareBreadcrumb, "timestamp"> & {
    timestamp?: Date | string;
  }): void {
    const normalized: FlareBreadcrumb = {
      ...breadcrumb,
      timestamp: toIsoString(breadcrumb.timestamp ?? new Date()),
    };

    if (addScopedBreadcrumb(normalized, this.maxBreadcrumbs)) return;

    this.globalBreadcrumbs.push(normalized);
    if (this.globalBreadcrumbs.length > this.maxBreadcrumbs) {
      this.globalBreadcrumbs.splice(
        0,
        this.globalBreadcrumbs.length - this.maxBreadcrumbs,
      );
    }
  }

  addSpan(span: Omit<FlareSpan, "startTime" | "endTime"> & {
    startTime?: Date | string;
    endTime?: Date | string;
  }): void {
    addScopedSpan({
      ...span,
      startTime: toIsoString(span.startTime),
      endTime: toIsoString(span.endTime),
    });
  }

  runWithContext<T>(scope: Partial<RequestScope>, callback: () => T): T {
    return runWithScope(scope, callback);
  }

  async flush(timeoutMs = this.timeoutMs): Promise<void> {
    const pending = Array.from(this.pending);
    if (pending.length === 0) return;

    await Promise.race([
      Promise.allSettled(pending),
      new Promise((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
  }

  private buildPayload(
    error: unknown,
    context: FlareCaptureContext,
  ): FlareIngestPayload {
    const normalized = normalizeError(error);
    const handled = context.handled ?? true;
    const mechanism = context.mechanism ?? "captureException";
    const request = sanitizeValue(context.request) as
      | FlareIngestPayload["request"]
      | undefined;

    return {
      source: "@flare/node-sdk",
      service: this.service,
      environment: this.environment,
      releaseVersion: this.releaseVersion,
      errorType: normalized.name,
      errorMessage: normalized.message,
      severity: context.severity ?? this.defaultSeverity,
      title: context.title,
      culprit: context.culprit,
      fingerprint: context.fingerprint,
      occurredAt: toIsoString(context.occurredAt ?? new Date()),
      stackTrace: parseStackTrace(error),
      exception: errorToException(error, handled, mechanism),
      request,
      trace: sanitizeValue(context.trace) as FlareIngestPayload["trace"],
      breadcrumbs: [
        ...this.globalBreadcrumbs,
        ...(context.breadcrumbs ?? []),
      ].slice(-this.maxBreadcrumbs),
      spans: context.spans,
      contexts: sanitizeValue(context.contexts) as FlareIngestPayload["contexts"],
      tags: context.tags,
      user: sanitizeValue(context.user) as FlareIngestPayload["user"],
      extra: sanitizeValue(context.extra) as FlareIngestPayload["extra"],
      metadata: sanitizeValue(context.metadata) as FlareIngestPayload["metadata"],
    };
  }

  private async send(
    payload: FlareIngestPayload,
  ): Promise<FlareCaptureResult | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Flare ingest failed with ${response.status}`);
      }

      const body = (await response.json()) as IngestResponse;
      return body.data ?? null;
    } catch (error) {
      console.warn(
        "[flare-sdk] failed to send event:",
        error instanceof Error ? error.message : error,
      );
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function toIsoString(value: Date | string | undefined): string | undefined {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : value;
}

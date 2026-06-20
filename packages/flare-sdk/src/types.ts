export type Severity = "critical" | "high" | "medium" | "low";
export type BreadcrumbLevel = "debug" | "info" | "warning" | "error" | "fatal";

export interface StackFrame {
  filename: string;
  function?: string;
  lineno?: number;
  colno?: number;
  inApp?: boolean;
  context?: string;
}

export interface FlareException {
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

export interface FlareRequestContext {
  method?: string;
  url?: string;
  route?: string;
  path?: string;
  query?: Record<string, unknown>;
  headers?: Record<string, string | string[]>;
  ip?: string;
  userAgent?: string;
  statusCode?: number;
}

export interface FlareTraceContext {
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  traceparent?: string;
}

export interface FlareBreadcrumb {
  timestamp?: string;
  category?: string;
  message?: string;
  level?: BreadcrumbLevel;
  data?: Record<string, unknown>;
}

export interface FlareSpan {
  name: string;
  op?: string;
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  startTime?: string;
  endTime?: string;
  durationMs?: number;
  status?: string;
  attributes?: Record<string, unknown>;
}

export interface FlareUser {
  id?: string;
  email?: string;
  username?: string;
  ipAddress?: string;
  [key: string]: unknown;
}

export interface FlareCaptureContext {
  severity?: Severity;
  fingerprint?: string;
  title?: string;
  culprit?: string;
  occurredAt?: Date | string;
  request?: FlareRequestContext;
  trace?: FlareTraceContext;
  breadcrumbs?: FlareBreadcrumb[];
  spans?: FlareSpan[];
  contexts?: Record<string, unknown>;
  tags?: Record<string, string | number | boolean | null>;
  user?: FlareUser;
  extra?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  handled?: boolean;
  mechanism?: string;
}

export interface FlareInitOptions {
  apiKey: string;
  endpoint?: string;
  service: string;
  environment?: string;
  releaseVersion?: string;
  enabled?: boolean;
  defaultSeverity?: Severity;
  maxBreadcrumbs?: number;
  timeoutMs?: number;
  captureUnhandledRejections?: boolean;
  captureUncaughtExceptions?: boolean;
  beforeSend?: (payload: FlareIngestPayload) => FlareIngestPayload | null;
}

export interface FlareIngestPayload {
  source: "@flare/node-sdk";
  service: string;
  environment: string;
  releaseVersion?: string;
  errorType?: string;
  errorMessage: string;
  severity: Severity;
  title?: string;
  culprit?: string;
  fingerprint?: string;
  occurredAt?: string;
  stackTrace: StackFrame[];
  exception: FlareException;
  request?: FlareRequestContext;
  trace?: FlareTraceContext;
  breadcrumbs?: FlareBreadcrumb[];
  spans?: FlareSpan[];
  contexts?: Record<string, unknown>;
  tags?: Record<string, string | number | boolean | null>;
  user?: FlareUser;
  extra?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface FlareCaptureResult {
  incidentId: string;
  eventId: string;
  created: boolean;
  investigationId: string | null;
}

export interface RequestScope {
  request?: FlareRequestContext;
  trace?: FlareTraceContext;
  breadcrumbs: FlareBreadcrumb[];
  spans: FlareSpan[];
  contexts?: Record<string, unknown>;
  tags?: Record<string, string | number | boolean | null>;
  user?: FlareUser;
  extra?: Record<string, unknown>;
}

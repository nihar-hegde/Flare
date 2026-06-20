import { FlareClient } from "./client.js";
import type {
  FlareBreadcrumb,
  FlareCaptureContext,
  FlareCaptureResult,
  FlareInitOptions,
  FlareSpan,
  RequestScope,
} from "./types.js";

let activeClient: FlareClient | null = null;
let rejectionHandlerInstalled = false;
let exceptionHandlerInstalled = false;

export function init(options: FlareInitOptions): FlareClient {
  const client = new FlareClient(options);
  activeClient = client;

  if (options.captureUnhandledRejections ?? true) {
    installUnhandledRejectionHandler();
  }
  if (options.captureUncaughtExceptions ?? true) {
    installUncaughtExceptionHandler();
  }

  return client;
}

export function getClient(): FlareClient {
  if (!activeClient) {
    throw new Error("Flare SDK is not initialized. Call init() first.");
  }
  return activeClient;
}

export function captureException(
  error: unknown,
  context?: FlareCaptureContext,
): Promise<FlareCaptureResult | null> {
  return getClient().captureException(error, context);
}

export function addBreadcrumb(
  breadcrumb: Omit<FlareBreadcrumb, "timestamp"> & {
    timestamp?: Date | string;
  },
): void {
  getClient().addBreadcrumb(breadcrumb);
}

export function addSpan(
  span: Omit<FlareSpan, "startTime" | "endTime"> & {
    startTime?: Date | string;
    endTime?: Date | string;
  },
): void {
  getClient().addSpan(span);
}

export function runWithContext<T>(
  scope: Partial<RequestScope>,
  callback: () => T,
): T {
  return getClient().runWithContext(scope, callback);
}

export function flush(timeoutMs?: number): Promise<void> {
  return getClient().flush(timeoutMs);
}

function installUnhandledRejectionHandler(): void {
  if (rejectionHandlerInstalled) return;
  rejectionHandlerInstalled = true;

  process.on("unhandledRejection", (reason) => {
    void getClient().captureException(reason, {
      handled: false,
      mechanism: "unhandledRejection",
      severity: "critical",
    });
  });
}

function installUncaughtExceptionHandler(): void {
  if (exceptionHandlerInstalled) return;
  exceptionHandlerInstalled = true;

  process.on("uncaughtException", (error) => {
    void getClient()
      .captureException(error, {
        handled: false,
        mechanism: "uncaughtException",
        severity: "critical",
      })
      .finally(async () => {
        await getClient().flush(2_000);
        process.exit(1);
      });
  });
}

export { FlareClient } from "./client.js";
export {
  expressErrorHandler,
  expressRequestHandler,
  requestContextFromIncoming,
  requestContextFromWebRequest,
  traceContextFromHeaders,
  traceContextFromWebHeaders,
  type ExpressLikeRequest,
  type ExpressLikeResponse,
} from "./middleware.js";
export type {
  BreadcrumbLevel,
  FlareBreadcrumb,
  FlareCaptureContext,
  FlareCaptureResult,
  FlareException,
  FlareIngestPayload,
  FlareInitOptions,
  FlareRequestContext,
  FlareSpan,
  FlareTraceContext,
  FlareUser,
  RequestScope,
  Severity,
  StackFrame,
} from "./types.js";

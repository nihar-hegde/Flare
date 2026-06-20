import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";
import type { FlareClient } from "./client.js";
import { redactHeaders } from "./redaction.js";
import type { FlareRequestContext, FlareTraceContext } from "./types.js";

type NextFunction = (error?: unknown) => void;

export interface ExpressLikeRequest extends IncomingMessage {
  originalUrl?: string;
  ip?: string;
  protocol?: string;
  route?: string | { path?: string };
}

export interface ExpressLikeResponse extends ServerResponse {
  statusCode: number;
}

export function expressRequestHandler(client: FlareClient) {
  return (
    req: ExpressLikeRequest,
    res: ExpressLikeResponse,
    next: NextFunction,
  ) => {
    client.runWithContext(
      {
        request: requestContextFromIncoming(req, res),
        trace: traceContextFromHeaders(req.headers),
      },
      next,
    );
  };
}

export function expressErrorHandler(client: FlareClient) {
  return (
    error: unknown,
    req: ExpressLikeRequest,
    res: ExpressLikeResponse,
    next: NextFunction,
  ) => {
    void client.captureException(error, {
      handled: false,
      mechanism: "express",
      request: requestContextFromIncoming(req, res),
      trace: traceContextFromHeaders(req.headers),
    });
    next(error);
  };
}

export function requestContextFromIncoming(
  req: ExpressLikeRequest,
  res?: ExpressLikeResponse,
): FlareRequestContext {
  const url = req.originalUrl ?? req.url ?? "";
  const host = headerToString(req.headers.host) ?? "localhost";
  const protocol =
    req.protocol ?? headerToString(req.headers["x-forwarded-proto"]) ?? "http";
  const fullUrl = url.startsWith("http") ? url : `${protocol}://${host}${url}`;
  const parsed = safeParseUrl(fullUrl);

  return {
    method: req.method,
    url: fullUrl,
    route: routePath(req.route),
    path: parsed?.pathname,
    query: parsed ? Object.fromEntries(parsed.searchParams.entries()) : undefined,
    headers: redactHeaders(req.headers),
    ip: req.ip ?? headerToString(req.headers["x-forwarded-for"]),
    userAgent: headerToString(req.headers["user-agent"]),
    statusCode: res?.statusCode,
  };
}

export function traceContextFromHeaders(
  headers: IncomingHttpHeaders,
): FlareTraceContext | undefined {
  const traceparent = headerToString(headers.traceparent);
  if (!traceparent) return undefined;

  const parts = traceparent.split("-");
  const traceId = parts[1];
  const spanId = parts[2];
  if (!traceId || !spanId) return { traceparent };

  return {
    traceparent,
    traceId,
    spanId,
  };
}

function safeParseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function routePath(route: ExpressLikeRequest["route"]): string | undefined {
  if (typeof route === "string") return route;
  return route?.path;
}

function headerToString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

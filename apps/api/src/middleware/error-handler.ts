import type { ErrorHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { env } from "../lib/env.js";
import type { AppEnv } from "../types/index.js";

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const errorHandler: ErrorHandler<AppEnv> = (err, c) => {
  const statusCode = err instanceof AppError ? err.statusCode : 500;
  const message =
    err instanceof AppError ? err.message : "Internal Server Error";

  console.error(`[ERROR] ${c.req.method} ${c.req.path}:`, err.message);

  return c.json(
    {
      success: false,
      error: message,
      ...(env.NODE_ENV === "development" && { stack: err.stack }),
    },
    statusCode as ContentfulStatusCode,
  );
};

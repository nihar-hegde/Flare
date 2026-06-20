import { timingSafeEqual } from "node:crypto";
import { env } from "./env.js";
import { AppError } from "../middleware/error-handler.js";

export function getBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token.trim();
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function verifySharedApiKey(headers: {
  authorization?: string;
  apiKey?: string;
}): void {
  if (!env.INGEST_API_KEY) {
    throw new AppError(500, "INGEST_API_KEY is not configured");
  }

  const token = getBearerToken(headers.authorization) ?? headers.apiKey;
  if (!token || !safeEqual(token, env.INGEST_API_KEY)) {
    throw new AppError(401, "Invalid API key");
  }
}

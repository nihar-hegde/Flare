import { addBreadcrumb, addSpan } from "@flare/node-sdk";

export function breadcrumb(
  category: string,
  message: string,
  data?: Record<string, unknown>,
): void {
  addBreadcrumb({
    category,
    message,
    level: "info",
    data,
  });
}

export async function withSpan<T>(
  name: string,
  op: string,
  attributes: Record<string, unknown>,
  fn: () => Promise<T>,
): Promise<T> {
  const start = new Date();
  try {
    const result = await fn();
    const end = new Date();
    addSpan({
      name,
      op,
      startTime: start,
      endTime: end,
      durationMs: end.getTime() - start.getTime(),
      status: "ok",
      attributes,
    });
    return result;
  } catch (error) {
    const end = new Date();
    addSpan({
      name,
      op,
      startTime: start,
      endTime: end,
      durationMs: end.getTime() - start.getTime(),
      status: "error",
      attributes,
    });
    throw error;
  }
}

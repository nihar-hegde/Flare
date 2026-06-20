import {
  addBreadcrumb,
  init,
  requestContextFromWebRequest,
  traceContextFromWebHeaders,
} from "@flare/node-sdk";
import { Hono } from "hono";
import { env } from "./lib/env.js";
import { createCheckout } from "./services/checkout.js";
import { reserveInventory } from "./services/inventory.js";
import { getCustomerProfile } from "./services/users.js";

const flare = init({
  apiKey: env.FLARE_INGEST_API_KEY,
  endpoint: env.FLARE_ENDPOINT,
  service: env.FLARE_SERVICE,
  environment: env.FLARE_ENVIRONMENT,
  releaseVersion: env.FLARE_RELEASE_VERSION,
});

const app = new Hono();

app.use("*", async (c, next) => {
  await flare.runWithContext(
    {
      request: requestContextFromWebRequest(c.req.raw),
      trace: traceContextFromWebHeaders(c.req.raw.headers),
      tags: {
        app: "demo-payments-api",
        route: c.req.path,
      },
    },
    async () => {
      addBreadcrumb({
        category: "http",
        message: "Incoming request",
        level: "info",
        data: {
          method: c.req.method,
          path: c.req.path,
          scenario: c.req.query("scenario"),
        },
      });
      await next();
    },
  );
});

app.onError(async (error, c) => {
  const result = await flare.captureException(error, {
    handled: false,
    mechanism: "hono",
    severity: "high",
    request: requestContextFromWebRequest(c.req.raw, 500),
    trace: traceContextFromWebHeaders(c.req.raw.headers),
    tags: {
      route: c.req.path,
      scenario: c.req.query("scenario") ?? c.req.param("scenario") ?? null,
    },
    extra: {
      demoHint:
        "This is an intentional demo failure from the sample payments API.",
    },
  });

  return c.json(
    {
      success: false,
      error: {
        name: error instanceof Error ? error.name : "Error",
        message: error instanceof Error ? error.message : String(error),
      },
      flare: result,
    },
    500,
  );
});

app.get("/", (c) =>
  c.json({
    name: "Flare Demo Payments API",
    service: env.FLARE_SERVICE,
    releaseVersion: env.FLARE_RELEASE_VERSION,
    healthy: true,
    routes: {
      health: "GET /health",
      checkoutSuccess: "GET /api/checkout",
      checkoutWithScenario:
        "GET /api/checkout?scenario=db-pool|payment-timeout|coupon-null|missing-profile|stale-inventory",
      shortcutCrash:
        "GET /crash/db-pool|payment-timeout|coupon-null|missing-profile|stale-inventory",
      customer: "GET /api/customers/cus_founder?scenario=missing-profile",
      inventory: "GET /api/inventory/pro_monthly?scenario=stale-inventory",
    },
  }),
);

app.get("/health", (c) =>
  c.json({
    ok: true,
    service: env.FLARE_SERVICE,
    environment: env.FLARE_ENVIRONMENT,
    releaseVersion: env.FLARE_RELEASE_VERSION,
  }),
);

app.get("/api/customers/:id", async (c) => {
  const profile = await getCustomerProfile(
    c.req.param("id"),
    c.req.query("scenario") ?? "success",
  );

  return c.json({ data: profile });
});

app.get("/api/inventory/:sku", async (c) => {
  const item = await reserveInventory(
    c.req.param("sku"),
    numberQuery(c.req.query("quantity"), 1),
    c.req.query("scenario") ?? "success",
  );

  return c.json({ data: item });
});

app.get("/api/checkout", async (c) => {
  const result = await createCheckout({
    customerId: c.req.query("customerId") ?? "cus_founder",
    sku: c.req.query("sku") ?? "pro_monthly",
    quantity: numberQuery(c.req.query("quantity"), 1),
    couponCode: c.req.query("couponCode"),
    scenario: c.req.query("scenario") ?? "success",
  });

  return c.json({ data: result });
});

app.post("/api/checkout", async (c) => {
  const body = await readJsonBody(c.req.raw);
  const result = await createCheckout({
    customerId: stringValue(body.customerId, "cus_founder"),
    sku: stringValue(body.sku, "pro_monthly"),
    quantity: numberValue(body.quantity, 1),
    couponCode: optionalStringValue(body.couponCode),
    scenario: stringValue(body.scenario, "success"),
  });

  return c.json({ data: result });
});

app.get("/crash/:scenario", async (c) => {
  const scenario = c.req.param("scenario");
  const result = await createCheckout({
    customerId: scenario === "missing-profile" ? "cus_missing" : "cus_founder",
    sku: "pro_monthly",
    quantity: 1,
    scenario,
  });

  return c.json({ data: result });
});

function numberQuery(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  return numberValue(value, fallback);
}

function numberValue(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function optionalStringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return body && typeof body === "object"
      ? (body as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export default app;

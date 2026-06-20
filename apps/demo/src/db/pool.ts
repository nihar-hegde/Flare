import { breadcrumb, withSpan } from "../lib/telemetry.js";

export class ConnectionPoolExhaustedError extends Error {
  constructor(public readonly activeConnections: number) {
    super(
      `Connection pool exhausted: ${activeConnections}/10 connections are active and acquire timed out`,
    );
    this.name = "ConnectionPoolExhaustedError";
  }
}

type PoolScenario = "success" | "db-pool";

export async function acquireConnection(scenario: PoolScenario) {
  breadcrumb("db.pool", "Acquiring database connection", { scenario });

  return withSpan(
    "db.pool.acquire",
    "db",
    { "db.system": "postgres", scenario },
    async () => {
      await sleep(18);

      if (scenario === "db-pool") {
        throw new ConnectionPoolExhaustedError(10);
      }

      return {
        id: `conn_${Math.random().toString(16).slice(2, 8)}`,
        release: () => {
          breadcrumb("db.pool", "Released database connection");
        },
      };
    },
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

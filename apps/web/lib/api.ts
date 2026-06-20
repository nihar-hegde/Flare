import type { AppType } from "api/app";
import { hc, type InferResponseType } from "hono/client";

const baseUrl =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

export const api = hc<AppType>(baseUrl);

// Response types derived from the API itself — single source of truth, no drift.
export type IncidentListItem = InferResponseType<
  typeof api.api.incidents.$get,
  200
>["data"][number];

export type IncidentDetail = InferResponseType<
  (typeof api.api.incidents)[":id"]["$get"],
  200
>["data"];

export type IncidentSuspect = IncidentDetail["suspects"][number];
export type Investigation = NonNullable<IncidentDetail["investigation"]>;
export type IncidentEvent = NonNullable<IncidentDetail["latestEvent"]>;
export type ActivityEntry = IncidentDetail["timeline"][number];

/** Fetch the incident list (uncached so the dashboard always reflects the DB). */
export async function fetchIncidents(): Promise<IncidentListItem[]> {
  const res = await api.api.incidents.$get(undefined, {
    init: { cache: "no-store" },
  });

  if (!res.ok) {
    throw new Error(`Failed to load incidents (HTTP ${res.status})`);
  }

  const body = await res.json();
  return body.data;
}

/** Fetch one incident's full detail; returns null on 404. */
export async function fetchIncident(id: string): Promise<IncidentDetail | null> {
  const res = await api.api.incidents[":id"].$get(
    { param: { id } },
    { init: { cache: "no-store" } },
  );

  if (res.status === 404) return null;

  if (!res.ok) {
    throw new Error(`Failed to load incident (HTTP ${res.status})`);
  }

  const body = await res.json();
  return body.data;
}

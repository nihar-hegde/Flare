import { and, eq } from "drizzle-orm";
import { db, incidents } from "@repo/db";

/**
 * List all incidents for an organization, newest activity first, each with its
 * latest investigation summary and top-ranked suspect (for the dashboard list).
 */
export function listIncidents(organizationId: string) {
  return db.query.incidents.findMany({
    where: eq(incidents.organizationId, organizationId),
    orderBy: (incident, { desc }) => [desc(incident.lastSeenAt)],
    with: {
      investigations: {
        orderBy: (investigation, { desc }) => [desc(investigation.createdAt)],
        limit: 1,
      },
      suspects: {
        orderBy: (suspect, { asc }) => [asc(suspect.rank)],
        limit: 1,
      },
    },
  });
}

/**
 * Fetch a single incident with everything the detail view needs: the latest
 * event (stack trace), investigations, ranked suspects (with their linked
 * change), and the activity timeline.
 */
export function getIncidentById(organizationId: string, incidentId: string) {
  return db.query.incidents.findFirst({
    where: and(
      eq(incidents.id, incidentId),
      eq(incidents.organizationId, organizationId),
    ),
    with: {
      events: {
        orderBy: (event, { desc }) => [desc(event.receivedAt)],
      },
      investigations: {
        orderBy: (investigation, { desc }) => [desc(investigation.createdAt)],
      },
      suspects: {
        orderBy: (suspect, { asc }) => [asc(suspect.rank)],
        with: {
          pullRequest: true,
          commit: true,
          deployment: true,
        },
      },
      activity: {
        orderBy: (entry, { desc }) => [desc(entry.createdAt)],
      },
    },
  });
}

export type IncidentListRow = Awaited<ReturnType<typeof listIncidents>>[number];
export type IncidentDetailRow = NonNullable<
  Awaited<ReturnType<typeof getIncidentById>>
>;

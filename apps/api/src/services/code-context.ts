import { and, desc, eq, inArray, ne, or } from "drizzle-orm";
import {
  commits,
  db,
  deployments,
  incidents,
  integrations,
  pullRequests,
  type Repository,
} from "@repo/db";
import type { InvestigationContext, SimilarIncident } from "../lib/ai/context.js";
import { buildCandidates, DEFAULT_WINDOW_HOURS } from "../lib/correlation.js";
import { getConfiguredGithubFullName } from "./github-sync.js";

/** All repositories connected under the org's GitHub integration(s). */
export async function getOrgRepositories(
  organizationId: string,
): Promise<Repository[]> {
  const rows = await db.query.integrations.findMany({
    where: and(
      eq(integrations.organizationId, organizationId),
      eq(integrations.provider, "github"),
    ),
    with: { repositories: true },
  });
  const repositories = rows.flatMap((row) => row.repositories);
  const configuredFullName = getConfiguredGithubFullName();

  if (!configuredFullName) return repositories;
  return repositories.filter((repo) => repo.fullName === configuredFullName);
}

/** Recent PRs / commits / deployments for the given repositories, newest first. */
async function getRepoChanges(repoIds: string[]) {
  if (repoIds.length === 0) {
    return { pullRequests: [], commits: [], deployments: [] };
  }
  const [prs, cmts, deps] = await Promise.all([
    db
      .select()
      .from(pullRequests)
      .where(inArray(pullRequests.repositoryId, repoIds))
      .orderBy(desc(pullRequests.mergedAt)),
    db
      .select()
      .from(commits)
      .where(inArray(commits.repositoryId, repoIds))
      .orderBy(desc(commits.authoredAt)),
    db
      .select()
      .from(deployments)
      .where(inArray(deployments.repositoryId, repoIds))
      .orderBy(desc(deployments.deployedAt)),
  ]);
  return { pullRequests: prs, commits: cmts, deployments: deps };
}

/** Prior resolved incidents matching this one's fingerprint or error type. */
async function findSimilarResolvedIncidents(
  organizationId: string,
  opts: { incidentId: string; fingerprint: string | null; errorType: string | null },
): Promise<SimilarIncident[]> {
  const matchers = [
    opts.fingerprint ? eq(incidents.fingerprint, opts.fingerprint) : undefined,
    opts.errorType ? eq(incidents.errorType, opts.errorType) : undefined,
  ].filter((m): m is NonNullable<typeof m> => m !== undefined);

  if (matchers.length === 0) return [];

  const rows = await db
    .select({
      id: incidents.id,
      title: incidents.title,
      errorType: incidents.errorType,
      resolution: incidents.resolution,
      resolvedAt: incidents.resolvedAt,
    })
    .from(incidents)
    .where(
      and(
        eq(incidents.organizationId, organizationId),
        eq(incidents.status, "resolved"),
        ne(incidents.id, opts.incidentId),
        or(...matchers),
      ),
    )
    .orderBy(desc(incidents.resolvedAt))
    .limit(5);

  return rows;
}

/**
 * Load everything the investigation engine needs for one incident: the incident
 * and its latest event's stack trace, the connected repos' recent changes,
 * similar past incidents, and the pre-ranked candidate changes. Returns null if
 * the incident doesn't exist for this org.
 */
export async function loadInvestigationContext(
  organizationId: string,
  incidentId: string,
): Promise<InvestigationContext | null> {
  const incident = await db.query.incidents.findFirst({
    where: and(
      eq(incidents.id, incidentId),
      eq(incidents.organizationId, organizationId),
    ),
    with: {
      events: {
        orderBy: (event, { desc: d }) => [d(event.receivedAt)],
        limit: 1,
      },
    },
  });

  if (!incident) return null;

  const latestEvent = incident.events[0];
  const stackFrames = latestEvent?.stackTrace ?? [];
  const analysisTime =
    latestEvent?.occurredAt ?? latestEvent?.receivedAt ?? incident.lastSeenAt;
  const repositories = await getOrgRepositories(organizationId);
  const repoIds = repositories.map((r) => r.id);

  const [{ pullRequests: prs, commits: cmts, deployments: deps }, similarIncidents] =
    await Promise.all([
      getRepoChanges(repoIds),
      findSimilarResolvedIncidents(organizationId, {
        incidentId,
        fingerprint: incident.fingerprint,
        errorType: incident.errorType,
      }),
    ]);

  const candidates = buildCandidates({
    frames: stackFrames,
    pullRequests: prs,
    commits: cmts,
    deployments: deps,
    incidentFirstSeen: analysisTime,
    incidentRelease: incident.releaseVersion,
    windowHours: DEFAULT_WINDOW_HOURS,
  });

  return {
    organizationId,
    incident,
    analysisTime,
    stackFrames,
    repositories: repositories.map((r) => ({
      id: r.id,
      fullName: r.fullName,
      defaultBranch: r.defaultBranch,
    })),
    pullRequests: prs,
    commits: cmts,
    deployments: deps,
    candidates,
    similarIncidents,
  };
}

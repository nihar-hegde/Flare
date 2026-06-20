// Load env BEFORE importing the db client (which reads DATABASE_URL at import).
import "./load-env.js";

import {
  activityLog,
  commits,
  db,
  deployments,
  events,
  incidents,
  incidentSuspects,
  integrations,
  investigations,
  notifications,
  organizations,
  pullRequests,
  repositories,
  users,
} from "./index.js";

// Hardcoded IDs so the single org/user are stable across reseeds and easy to
// reference from the API/dashboard until Supabase Auth is wired up.
const ORG_ID = "00000000-0000-0000-0000-000000000001";
const USER_ID = "00000000-0000-0000-0000-000000000002";

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);
const daysAgo = (d: number) => new Date(Date.now() - d * 24 * 60 * 60_000);

async function main() {
  console.log("Clearing existing data...");
  // Children first (FKs use cascade, but be explicit/deterministic).
  await db.delete(activityLog);
  await db.delete(notifications);
  await db.delete(incidentSuspects);
  await db.delete(investigations);
  await db.delete(events);
  await db.delete(deployments);
  await db.delete(commits);
  await db.delete(pullRequests);
  await db.delete(repositories);
  await db.delete(incidents);
  await db.delete(integrations);
  await db.delete(users);
  await db.delete(organizations);

  console.log("Seeding org + user (hardcoded)...");
  await db.insert(organizations).values({
    id: ORG_ID,
    name: "Acme Inc",
    slug: "acme",
  });
  await db.insert(users).values({
    id: USER_ID,
    organizationId: ORG_ID,
    email: "demo@acme.test",
    name: "Demo Engineer",
    role: "owner",
  });

  console.log("Seeding integrations + repository...");
  const [sentryIntegration] = await db
    .insert(integrations)
    .values({
      organizationId: ORG_ID,
      provider: "sentry",
      kind: "source",
      externalAccountId: "acme-sentry",
      config: { project: "payments" },
    })
    .returning();

  const [githubIntegration] = await db
    .insert(integrations)
    .values({
      organizationId: ORG_ID,
      provider: "github",
      kind: "context",
      externalAccountId: "acme",
      config: { installationId: "demo" },
    })
    .returning();

  if (!sentryIntegration || !githubIntegration)
    throw new Error("Failed to insert integrations");

  const [repo] = await db
    .insert(repositories)
    .values({
      integrationId: githubIntegration.id,
      owner: "acme",
      name: "payments",
      fullName: "acme/payments",
      defaultBranch: "main",
    })
    .returning();

  if (!repo) throw new Error("Failed to insert repository");

  console.log("Seeding code context (PRs, commits, deployment)...");
  const [retryPr, invoicePr] = await db
    .insert(pullRequests)
    .values([
      {
        repositoryId: repo.id,
        number: 284,
        title: "Implement payment retry mechanism",
        body: "Adds automatic retries for failed payment transactions. Retries on any transient DB/network error.",
        author: "j.martinez",
        branch: "feat/payment-retry",
        baseBranch: "main",
        mergeCommitSha: "a1b2c3d4",
        filesChanged: [
          "src/payments/retry.ts",
          "src/payments/processor.ts",
          "src/db/pool.ts",
        ],
        additions: 142,
        deletions: 8,
        url: "https://github.com/acme/payments/pull/284",
        mergedAt: minutesAgo(20),
      },
      {
        repositoryId: repo.id,
        number: 281,
        title: "Update invoice PDF template",
        body: "Cosmetic changes to the invoice PDF layout.",
        author: "s.okoye",
        branch: "chore/invoice-template",
        baseBranch: "main",
        mergeCommitSha: "e5f6a7b8",
        filesChanged: ["src/invoices/template.tsx"],
        additions: 30,
        deletions: 12,
        url: "https://github.com/acme/payments/pull/281",
        mergedAt: daysAgo(1),
      },
    ])
    .returning();

  if (!retryPr) throw new Error("Failed to insert PRs");

  await db.insert(commits).values({
    repositoryId: repo.id,
    sha: "a1b2c3d4",
    message: "Implement payment retry mechanism (#284)",
    author: "j.martinez",
    filesChanged: ["src/payments/retry.ts", "src/db/pool.ts"],
    url: "https://github.com/acme/payments/commit/a1b2c3d4",
    authoredAt: minutesAgo(20),
  });

  await db.insert(deployments).values({
    repositoryId: repo.id,
    releaseVersion: "v2.14.0",
    environment: "production",
    commitSha: "a1b2c3d4",
    url: "https://github.com/acme/payments/releases/tag/v2.14.0",
    deployedAt: minutesAgo(15),
  });

  console.log("Seeding the active incident + event...");
  const [incident] = await db
    .insert(incidents)
    .values({
      organizationId: ORG_ID,
      sourceIntegrationId: sentryIntegration.id,
      externalId: "PAYMENTS-1Z9",
      fingerprint: "connection-pool-exhausted",
      title: "TimeoutError: connection pool exhausted",
      culprit: "src/db/pool.ts in acquireConnection",
      service: "payments-api",
      environment: "production",
      errorType: "TimeoutError",
      errorMessage: "Timeout acquiring connection from pool after 5000ms",
      severity: "critical",
      status: "open",
      releaseVersion: "v2.14.0",
      permalink: "https://acme.sentry.io/issues/PAYMENTS-1Z9",
      occurrenceCount: 312,
      affectedUsers: 1840,
      firstSeenAt: minutesAgo(12),
      lastSeenAt: minutesAgo(1),
    })
    .returning();

  if (!incident) throw new Error("Failed to insert incident");

  await db.insert(events).values({
    incidentId: incident.id,
    occurredAt: minutesAgo(11),
    stackTrace: [
      {
        filename: "src/db/pool.ts",
        function: "acquireConnection",
        lineno: 42,
        inApp: true,
      },
      {
        filename: "src/payments/retry.ts",
        function: "retryTransaction",
        lineno: 88,
        inApp: true,
      },
      {
        filename: "src/payments/processor.ts",
        function: "processPayment",
        lineno: 21,
        inApp: true,
      },
    ],
    raw: { note: "seeded synthetic Sentry event" },
  });

  console.log("Seeding a historical (resolved) incident for similarity...");
  const [pastIncident] = await db
    .insert(incidents)
    .values({
      organizationId: ORG_ID,
      sourceIntegrationId: sentryIntegration.id,
      title: "Connection pool exhaustion after retry logic change",
      service: "payments-api",
      environment: "production",
      errorType: "TimeoutError",
      severity: "high",
      status: "resolved",
      occurrenceCount: 95,
      firstSeenAt: daysAgo(92),
      lastSeenAt: daysAgo(92),
      resolvedAt: daysAgo(92),
      resolution:
        "Rolled back the retry change and re-implemented with exponential backoff and a retry cap.",
    })
    .returning();

  console.log("Seeding a completed investigation + ranked suspects...");
  const [investigation] = await db
    .insert(investigations)
    .values({
      incidentId: incident.id,
      status: "complete",
      rootCause:
        "PR #284's retry mechanism retries on any transient error with no backoff or cap, opening a new DB connection per attempt and exhausting the pool.",
      confidence: 87,
      summary:
        "Unbounded payment retries introduced 15 min before the incident exhausted the connection pool.",
      reasoning:
        "The top stack frame is src/db/pool.ts:acquireConnection, called from src/payments/retry.ts:retryTransaction. PR #284 (merged 20 min ago, deployed as v2.14.0 15 min ago) modified both files and added retry logic. Logs show retry attempt 47 with no backoff. This matches a prior resolved incident with the same fingerprint.",
      analysis: {
        mechanism:
          "The new retry path repeatedly opens database connections without backoff or a cap, exhausting the pool before checkout requests can acquire a connection.",
        failurePoint: "src/db/pool.ts:42 in acquireConnection",
        causalChain: [
          {
            title: "Checkout hits retry path",
            detail:
              "Payment processing calls retryTransaction after transient payment failures.",
          },
          {
            title: "Retries are unbounded",
            detail:
              "PR #284 added retry logic that keeps retrying without exponential backoff or a maximum attempt count.",
          },
          {
            title: "Connections are exhausted",
            detail:
              "Each attempt opens or holds a pool connection until all 10 connections are active and new requests time out.",
          },
        ],
        keyEvidence: [
          {
            title: "Top frame is in the pool",
            detail:
              "The stack trace fails at src/db/pool.ts:42 in acquireConnection.",
            kind: "stack_trace",
            strength: "supports",
            reference: "src/db/pool.ts:42",
          },
          {
            title: "Suspect PR touched failing files",
            detail:
              "PR #284 modified both src/db/pool.ts and src/payments/retry.ts shortly before the incident.",
            kind: "patch",
            strength: "supports",
            reference: "PR #284",
          },
          {
            title: "Timing matches deploy",
            detail:
              "The incident began about 3 minutes after v2.14.0 deployed.",
            kind: "timing",
            strength: "supports",
            reference: "v2.14.0",
          },
        ],
        confidenceRationale:
          "Confidence is high because the failing stack frame, changed files, deployment timing, and retry log evidence all point to the same code path.",
        confidenceFactors: [
          {
            label: "Stack/source overlap",
            impact: "raises",
            detail:
              "The suspect PR changed the top failing frame and the caller on the retry path.",
          },
          {
            label: "Prior incident match",
            impact: "raises",
            detail:
              "A resolved incident with the same fingerprint had the same pool-exhaustion mechanism.",
          },
          {
            label: "No source patch shown in seed",
            impact: "lowers",
            detail:
              "The seed report summarizes the patch rather than embedding a full source diff.",
          },
        ],
        validationSteps: [
          "Deploy a rollback or capped retry fix and confirm connection acquisition errors stop.",
          "Run the checkout flow under transient payment failure and verify retries stop after the configured cap.",
          "Watch active pool connections return below saturation during the retry scenario.",
        ],
        remainingUncertainty: [
          "The seed scenario does not include live pool metrics beyond the summarized retry log.",
        ],
      },
      suggestedFixes: [
        {
          title: "Roll back PR #284",
          detail:
            "Revert v2.14.0 to immediately relieve the connection pool, then re-land the retry logic safely.",
          action: "rollback",
        },
        {
          title: "Add exponential backoff + retry cap",
          detail:
            "Bound retries (e.g. max 3) with exponential backoff and reuse pooled connections instead of opening new ones per attempt.",
          action: "code_change",
        },
      ],
      evidence: [
        "Incident began ~3 min after v2.14.0 deploy",
        "Top stack frame src/db/pool.ts:42 was modified by PR #284",
        "Logs show retry attempt 47 with no backoff",
        "A prior resolved incident shares the same fingerprint",
      ],
      steps: [
        {
          index: 0,
          tool: "get_stack_trace",
          reasoning: "Identify which files/functions are on the failing path.",
          output: "Top in-app frame: src/db/pool.ts:acquireConnection:42",
        },
        {
          index: 1,
          tool: "list_recent_changes",
          reasoning: "Find changes that touched the failing files recently.",
          output: "PR #284 modified src/db/pool.ts and src/payments/retry.ts",
        },
        {
          index: 2,
          tool: "get_pr",
          input: { number: 284 },
          reasoning: "Inspect the diff to confirm the mechanism.",
          output: "Adds retry loop with no backoff or cap.",
        },
      ],
      similarIncidentId: pastIncident?.id ?? null,
      model: "openai:gpt-4o",
      startedAt: minutesAgo(10),
      completedAt: minutesAgo(9),
    })
    .returning();

  if (!investigation) throw new Error("Failed to insert investigation");

  await db.insert(incidentSuspects).values([
    {
      incidentId: incident.id,
      investigationId: investigation.id,
      changeType: "pull_request",
      pullRequestId: retryPr.id,
      label: "PR #284 — Implement payment retry mechanism",
      likelihood: 87,
      rank: 1,
      rationale:
        "Modifies both files on the failing stack trace and introduces unbounded retries.",
    },
    {
      incidentId: incident.id,
      investigationId: investigation.id,
      changeType: "pull_request",
      pullRequestId: invoicePr?.id ?? null,
      label: "PR #281 — Update invoice PDF template",
      likelihood: 4,
      rank: 2,
      rationale: "Touches unrelated invoice rendering code; merged a day ago.",
    },
  ]);

  await db.insert(activityLog).values([
    {
      incidentId: incident.id,
      type: "ingested",
      message: "Incident received from Sentry",
      actor: "sentry",
    },
    {
      incidentId: incident.id,
      type: "investigation_started",
      message: "Flare agent began investigating",
      actor: "flare-agent",
    },
    {
      incidentId: incident.id,
      type: "investigation_completed",
      message: "Root cause identified: PR #284 (87% confidence)",
      actor: "flare-agent",
    },
  ]);

  const total = await db.$count(incidents);
  console.log(`Done. ${total} incidents seeded.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });

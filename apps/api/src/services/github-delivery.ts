import { and, eq } from "drizzle-orm";
import { activityLog, db, type Incident } from "@repo/db";
import type { InvestigationContext } from "../lib/ai/context.js";
import type { InvestigationReport } from "../lib/ai/schema.js";
import { env } from "../lib/env.js";
import { createGithubIssue, postGithubIssueComment } from "./github-sync.js";

/** Don't post low-confidence guesses into someone's PR thread. */
const MIN_CONFIDENCE_TO_POST = 60;
/** A PR merged within this window is "fresh" → comment on it directly. Older
 *  ones get a new issue instead, since the PR thread is effectively dead and the
 *  code may have moved. */
const FRESH_MERGE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

interface DeliverArgs {
  ctx: InvestigationContext;
  report: InvestigationReport;
  confidence: number;
  investigationId: string;
}

/**
 * Turn a completed investigation into an action in GitHub: comment on the
 * suspect PR (fresh merges) or open a regression issue (stale / no PR). Gated,
 * idempotent, and non-fatal — a failure here never affects the investigation.
 */
export async function deliverInvestigationToGithub(args: DeliverArgs): Promise<void> {
  const { ctx, report, confidence, investigationId } = args;

  if (!env.GITHUB_WRITE_ENABLED) return;
  if (!report.rootCause || confidence < MIN_CONFIDENCE_TO_POST) return;

  // Idempotent: post at most once per incident (re-investigations don't spam).
  const alreadyNotified = await db.query.activityLog.findFirst({
    where: and(
      eq(activityLog.incidentId, ctx.incident.id),
      eq(activityLog.type, "notified"),
    ),
  });
  if (alreadyNotified) return;

  // Highest-likelihood suspect that is a pull request, resolved to a real row.
  const prSuspect = [...report.suspects]
    .filter((s) => s.changeType === "pull_request")
    .sort((a, b) => b.likelihood - a.likelihood)[0];
  const prNumber = prSuspect
    ? Number(prSuspect.identifier.trim().replace(/^#/, ""))
    : NaN;
  const pr = Number.isFinite(prNumber)
    ? ctx.pullRequests.find((p) => p.number === prNumber)
    : undefined;

  const fallbackBody = formatReportMarkdown(
    ctx.incident,
    report,
    confidence,
    prSuspect?.rationale,
  );
  const prCommentBody =
    artifactBody(report, "pr_comment") ?? fallbackBody;
  const issueBody =
    artifactBody(report, "github_issue") ?? fallbackBody;

  try {
    const fresh = pr?.mergedAt
      ? Date.now() - pr.mergedAt.getTime() <= FRESH_MERGE_WINDOW_MS
      : false;

    let message: string;
    let metadata: Record<string, unknown>;

    if (pr && fresh) {
      const { url } = await postGithubIssueComment({
        issueNumber: pr.number,
        body: prCommentBody,
      });
      message = `Commented on PR #${pr.number} with the investigation`;
      metadata = { channel: "github", kind: "pr_comment", ref: `#${pr.number}`, url, investigationId };
    } else {
      const title = `Flare: production regression — ${ctx.incident.title}`.slice(0, 220);
      const body = pr
        ? `${issueBody}\n\n---\n_Introduced in #${pr.number} (merged ${pr.mergedAt?.toISOString() ?? "unknown"}). Surfacing now via Flare._`
        : issueBody;
      const { url, number } = await createGithubIssue({ title, body });
      message = `Opened issue #${number ?? "?"} for this regression`;
      metadata = { channel: "github", kind: "issue", ref: `#${number ?? "?"}`, url, investigationId };
    }

    await db.insert(activityLog).values({
      incidentId: ctx.incident.id,
      type: "notified",
      message,
      actor: "flare-agent",
      metadata,
    });
  } catch (err) {
    // Non-fatal: most likely the token lacks write scope, or rate limiting.
    // Leave no "notified" row so the next run can retry.
    console.warn(
      `[github-delivery ${investigationId}] failed:`,
      err instanceof Error ? err.message : err,
    );
  }
}

function artifactBody(
  report: InvestigationReport,
  kind: NonNullable<InvestigationReport["fixHandoff"]>["artifacts"][number]["kind"],
): string | null {
  return (
    report.fixHandoff?.artifacts.find((artifact) => artifact.kind === kind)
      ?.body ?? null
  );
}

function bulletList(items: string[], max: number, empty: string): string {
  const shown = items.filter(Boolean).slice(0, max);
  return shown.length ? shown.map((i) => `- ${i}`).join("\n") : `- ${empty}`;
}

function formatReportMarkdown(
  incident: Incident,
  report: InvestigationReport,
  confidence: number,
  prRationale: string | undefined,
): string {
  const evidence = bulletList(report.evidence, 6, "See the Flare dashboard for details.");
  const fixes = bulletList(
    report.suggestedFixes.map((f) => `**${f.title}** (${f.action}) — ${f.detail}`),
    3,
    "See the Flare dashboard for details.",
  );
  const dashboardUrl = `${env.CORS_ORIGIN}/incidents/${incident.id}`;

  return [
    "## 🔥 Flare: this change is the likely cause of a production incident",
    "",
    `**Incident:** ${incident.title}`,
    `**Service:** ${incident.service ?? "unknown"} · **Confidence:** ${confidence}%`,
    "",
    "### Root cause",
    report.rootCause,
    ...(prRationale ? ["", "### Why this change", prRationale] : []),
    "",
    "### Evidence",
    evidence,
    "",
    "### Suggested fix",
    fixes,
    "",
    "---",
    `🤖 Posted automatically by Flare — AI-generated analysis, verify before acting. [View the full investigation →](${dashboardUrl})`,
  ].join("\n");
}

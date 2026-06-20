import { eq } from "drizzle-orm";
import {
  activityLog,
  db,
  incidentSuspects,
  investigations,
  type Investigation,
} from "@repo/db";
import type { InvestigationContext } from "../lib/ai/context.js";
import { investigate, type InvestigationResult } from "../lib/ai/investigator.js";
import type { ReportSuspect } from "../lib/ai/schema.js";
import { env } from "../lib/env.js";
import { loadInvestigationContext } from "./code-context.js";
import { deliverInvestigationToGithub } from "./github-delivery.js";
import { syncConfiguredGithubRepo } from "./github-sync.js";

type NewSuspect = typeof incidentSuspects.$inferInsert;

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const METADATA_ONLY_CONFIDENCE_CAP = 85;

/**
 * Open a fresh investigation for an incident. Replaces any prior investigation
 * (and its suspects, via cascade) so an incident always shows one current
 * analysis. Returns immediately with a `running` row; the heavy work happens in
 * `processInvestigation`.
 */
export async function startInvestigation(
  incidentId: string,
): Promise<Investigation> {
  return db.transaction(async (tx) => {
    await tx
      .delete(investigations)
      .where(eq(investigations.incidentId, incidentId));

    const [investigation] = await tx
      .insert(investigations)
      .values({
        incidentId,
        status: "running",
        model: env.INVESTIGATOR_MODEL,
        startedAt: new Date(),
      })
      .returning();

    if (!investigation) {
      throw new Error("Failed to create investigation");
    }

    await tx.insert(activityLog).values({
      incidentId,
      type: "investigation_started",
      message: "Flare agent began investigating",
      actor: "flare-agent",
    });

    return investigation;
  });
}

/**
 * Run the agent and persist the result onto an existing `running` investigation.
 * Designed to be fire-and-forget: any failure is caught and recorded on the row
 * as `failed` so the dashboard reflects it rather than the request hanging.
 */
export async function processInvestigation(
  organizationId: string,
  incidentId: string,
  investigationId: string,
): Promise<void> {
  try {
    await syncConfiguredGithubRepo(organizationId).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[investigation ${investigationId}] GitHub sync skipped:`, message);
      return null;
    });

    const ctx = await loadInvestigationContext(organizationId, incidentId);
    if (!ctx) throw new Error(`Incident ${incidentId} not found`);

    const result = await investigate(ctx);
    await persistResult(ctx, investigationId, result);

    // Optional, gated, non-fatal: turn the finished report into a GitHub action.
    await deliverInvestigationToGithub({
      ctx,
      report: result.report,
      confidence: calibratedConfidence(result.report.confidence, result.steps),
      investigationId,
    }).catch((err) => {
      console.warn(
        `[investigation ${investigationId}] GitHub delivery error:`,
        err instanceof Error ? err.message : err,
      );
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[investigation ${investigationId}] failed:`, message);

    await db.transaction(async (tx) => {
      await tx
        .update(investigations)
        .set({ status: "failed", error: message, completedAt: new Date() })
        .where(eq(investigations.id, investigationId));
      await tx.insert(activityLog).values({
        incidentId,
        type: "investigation_failed",
        message: `Investigation failed: ${message}`,
        actor: "flare-agent",
      });
    });
  }
}

async function persistResult(
  ctx: InvestigationContext,
  investigationId: string,
  result: InvestigationResult,
): Promise<void> {
  const { report } = result;
  const confidence = calibratedConfidence(report.confidence, result.steps);
  const suspectRows = resolveSuspects(ctx, report.suspects, investigationId);

  await db.transaction(async (tx) => {
    await tx
      .update(investigations)
      .set({
        status: "complete",
        rootCause: report.rootCause,
        confidence,
        summary: report.summary,
        reasoning: report.reasoning,
        suggestedFixes: report.suggestedFixes,
        evidence: report.evidence,
        steps: result.steps,
        similarIncidentId: ctx.similarIncidents[0]?.id ?? null,
        model: result.model,
        tokens: result.tokens,
        completedAt: new Date(),
      })
      .where(eq(investigations.id, investigationId));

    if (suspectRows.length > 0) {
      await tx.insert(incidentSuspects).values(suspectRows);
    }

    await tx.insert(activityLog).values({
      incidentId: ctx.incident.id,
      type: "investigation_completed",
      message: report.rootCause
        ? `Root cause identified (${confidence}% confidence)`
        : "Investigation completed",
      actor: "flare-agent",
    });
  });
}

function calibratedConfidence(
  reportedConfidence: number,
  steps: InvestigationResult["steps"],
): number {
  const confidence = clamp(reportedConfidence);
  const inspectedCode = steps.some(
    (step) =>
      step.tool === "get_stack_frame_source" || step.tool === "get_pr_file_patch",
  );

  return inspectedCode
    ? confidence
    : Math.min(confidence, METADATA_ONLY_CONFIDENCE_CAP);
}

/**
 * Turn the model's suspects into rows: rank by likelihood (highest first) and
 * resolve each `identifier` back to a real PR/commit/deployment row when we can.
 * Unresolved references still persist (with a null FK) so the ranking is intact.
 */
function resolveSuspects(
  ctx: InvestigationContext,
  suspects: ReportSuspect[],
  investigationId: string,
): NewSuspect[] {
  return [...suspects]
    .sort((a, b) => b.likelihood - a.likelihood)
    .map((suspect, idx) => {
      const base: NewSuspect = {
        incidentId: ctx.incident.id,
        investigationId,
        changeType: suspect.changeType,
        label: suspect.label,
        likelihood: clamp(suspect.likelihood),
        rank: idx + 1,
        rationale: suspect.rationale,
      };

      const id = suspect.identifier.trim().replace(/^#/, "");

      if (suspect.changeType === "pull_request") {
        const pr = ctx.pullRequests.find((p) => String(p.number) === id);
        return { ...base, pullRequestId: pr?.id ?? null };
      }
      if (suspect.changeType === "commit") {
        const commit = ctx.commits.find(
          (c) => c.sha === id || c.sha.startsWith(id) || id.startsWith(c.sha),
        );
        return { ...base, commitId: commit?.id ?? null };
      }
      const deployment = ctx.deployments.find((d) => d.releaseVersion === id);
      return { ...base, deploymentId: deployment?.id ?? null };
    });
}

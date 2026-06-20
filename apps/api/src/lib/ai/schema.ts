import { z } from "zod";

/**
 * The structured report the investigation agent must produce. This is the
 * contract between the model and our persistence layer — every field maps onto a
 * column in `investigations` / `incident_suspects`. Kept flat and fully required
 * for reliable structured output from OpenAI.
 */

export const suggestedFixSchema = z.object({
  title: z
    .string()
    .describe(
      "Short imperative title, e.g. 'Patch src/db/pool.ts connection release path' or 'Roll back PR #284'.",
    ),
  detail: z
    .string()
    .describe(
      "One or two specific sentences explaining what to change and why it helps. Prefer file/function-level code fixes when code evidence was inspected; rollback should usually be a fallback mitigation.",
    ),
  action: z
    .enum(["rollback", "code_change", "config_change", "investigate"])
    .describe("The category of action this fix represents."),
});

export const reportSuspectSchema = z.object({
  changeType: z
    .enum(["pull_request", "commit", "deployment"])
    .describe("Which kind of change this suspect is."),
  identifier: z
    .string()
    .describe(
      "How to find the change: the PR number (e.g. '284'), the commit SHA, or the release version. Must match a change surfaced by the tools.",
    ),
  label: z
    .string()
    .describe("Human-readable label, e.g. 'PR #284 — Implement payment retry'."),
  likelihood: z
    .number()
    .int()
    .min(0)
    .max(100)
    .describe("How likely this change caused the incident, 0-100."),
  rationale: z
    .string()
    .describe("Why this change is (or isn't) a strong suspect, grounded in evidence."),
});

export const investigationReportSchema = z.object({
  rootCause: z
    .string()
    .describe("The single most likely root cause, stated concisely."),
  confidence: z
    .number()
    .int()
    .min(0)
    .max(100)
    .describe("Calibrated confidence in the root cause, 0-100."),
  summary: z
    .string()
    .describe("One-sentence headline an on-call engineer could read at a glance."),
  reasoning: z
    .string()
    .describe(
      "The chain of reasoning that links the stack trace to the suspected change(s), citing the evidence gathered.",
    ),
  suspects: z
    .array(reportSuspectSchema)
    .describe("Candidate changes, ranked implicitly by likelihood (highest first)."),
  suggestedFixes: z
    .array(suggestedFixSchema)
    .describe("One to three concrete, actionable fixes."),
  evidence: z
    .array(z.string())
    .describe("Short factual bullet points that support the conclusion."),
});

export type InvestigationReport = z.infer<typeof investigationReportSchema>;
export type ReportSuspect = z.infer<typeof reportSuspectSchema>;

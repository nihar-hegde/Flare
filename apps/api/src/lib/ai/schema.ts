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

export const evidenceItemSchema = z.object({
  title: z
    .string()
    .describe(
      "Short label for the evidence, e.g. 'Top frame matches new file'.",
    ),
  detail: z
    .string()
    .describe(
      "One specific factual sentence. Cite concrete files, lines, PRs, timing, patches, deployments, or prior incidents when available.",
    ),
  kind: z
    .enum([
      "stack_trace",
      "source",
      "patch",
      "blame",
      "timing",
      "deployment",
      "similar_incident",
      "metadata",
    ])
    .describe("The evidence category."),
  strength: z
    .enum(["supports", "rules_out", "context"])
    .describe(
      "Whether this evidence supports the conclusion, rules out a suspect, or provides context.",
    ),
  reference: z
    .string()
    .nullable()
    .describe(
      "Compact reference such as 'src/db/pool.ts:42' or 'PR #284'. Use null when no compact reference exists.",
    ),
});

export const causalLinkSchema = z.object({
  title: z
    .string()
    .describe("Short causal step title, e.g. 'Request enters refund route'."),
  detail: z
    .string()
    .describe("One sentence explaining this step in the incident mechanism."),
});

export const confidenceFactorSchema = z.object({
  label: z
    .string()
    .describe("Short label, e.g. 'Exact throwing line inspected'."),
  impact: z
    .enum(["raises", "lowers"])
    .describe("Whether this factor raises or lowers confidence."),
  detail: z
    .string()
    .describe("One sentence explaining the factor's effect on confidence."),
});

export const analysisSchema = z.object({
  mechanism: z
    .string()
    .describe(
      "A concise mechanism statement: how the incident happens at runtime, not just which PR is suspected.",
    ),
  failurePoint: z
    .string()
    .describe(
      "The most relevant file/function/line or route where the failure manifests, e.g. 'src/services/refunds.ts:6 in processRefundTransaction'.",
    ),
  causalChain: z
    .array(causalLinkSchema)
    .min(2)
    .max(5)
    .describe(
      "Two to five ordered steps from user/request path to failing code to production symptom.",
    ),
  keyEvidence: z
    .array(evidenceItemSchema)
    .min(2)
    .max(6)
    .describe(
      "The strongest structured evidence items, ordered by usefulness to an on-call engineer.",
    ),
  confidenceRationale: z
    .string()
    .describe(
      "One or two sentences explaining why the confidence score is calibrated where it is.",
    ),
  confidenceFactors: z
    .array(confidenceFactorSchema)
    .min(1)
    .max(5)
    .describe(
      "Specific factors that raise or lower confidence, including uncertainty when relevant.",
    ),
  validationSteps: z
    .array(z.string())
    .min(1)
    .max(4)
    .describe(
      "Concrete steps an engineer can run after applying the fix or rollback to verify the incident is resolved.",
    ),
  remainingUncertainty: z
    .array(z.string())
    .max(3)
    .describe(
      "Known uncertainty or missing data. Use an empty array when the inspected evidence fully explains the incident.",
    ),
});

export const fixValidationStepSchema = z.object({
  title: z
    .string()
    .describe(
      "Short validation title, e.g. 'Exercise refund endpoint' or 'Run focused regression test'.",
    ),
  command: z
    .string()
    .nullable()
    .describe(
      "Exact command, request, or check to run when known, e.g. 'pnpm test refunds'. Use null when no exact command can be inferred.",
    ),
  expectedOutcome: z
    .string()
    .describe("What must be true for the validation step to pass."),
});

export const handoffArtifactSchema = z.object({
  kind: z
    .enum([
      "agent_prompt",
      "github_issue",
      "pr_comment",
      "slack_update",
      "pr_description",
    ])
    .describe("The ready-to-copy handoff artifact type."),
  title: z
    .string()
    .describe("Short UI label, e.g. 'Agent Prompt' or 'PR Comment'."),
  description: z
    .string()
    .describe("One short sentence explaining where this artifact should be used."),
  body: z
    .string()
    .describe(
      "Complete ready-to-copy Markdown/plaintext body. Include concrete incident context, proof, fix, validation, and remaining risk when relevant.",
    ),
});

export const fixHandoffSchema = z.object({
  headline: z
    .string()
    .describe(
      "One sentence that says what caused the incident and what the engineer should do next.",
    ),
  fixPlan: z
    .object({
      title: z
        .string()
        .describe("Short imperative title for the primary fix."),
      action: z
        .enum(["rollback", "code_change", "config_change", "investigate"])
        .describe("The category of action for the primary fix."),
      detail: z
        .string()
        .describe(
          "Specific implementation guidance naming files/functions and behavior to change when known.",
        ),
      targetFiles: z
        .array(z.string())
        .max(8)
        .describe(
          "Repo-relative files the fixing agent should inspect or edit first. Use [] only when no file can be inferred.",
        ),
    })
    .describe("The primary fix plan, kept consistent with suggestedFixes[0]."),
  proof: z
    .array(evidenceItemSchema)
    .min(2)
    .max(6)
    .describe(
      "The strongest proof that connects the suspect change to the incident. Prefer concrete stack/source/patch/blame/timing references.",
    ),
  validationPlan: z
    .array(fixValidationStepSchema)
    .min(2)
    .max(5)
    .describe(
      "Concrete post-fix validation steps with commands when they can be inferred.",
    ),
  recommendedOwnerFiles: z
    .array(z.string())
    .max(8)
    .describe(
      "Files or areas that should own the fix/review. Prefer files from stack frames and inspected patches.",
    ),
  remainingRisk: z
    .array(z.string())
    .max(4)
    .describe(
      "Risks or open questions to mention in the fixing PR. Use [] when there are no meaningful known risks.",
    ),
  artifacts: z
    .array(handoffArtifactSchema)
    .min(5)
    .max(5)
    .refine(
      (artifacts) =>
        new Set(artifacts.map((a) => a.kind)).size === artifacts.length,
      {
        message:
          "Each artifact kind must appear exactly once: agent_prompt, github_issue, pr_comment, slack_update, pr_description.",
      },
    )
    .describe(
      "Exactly five copy-ready artifacts, one of each kind: agent_prompt, github_issue, pr_comment, slack_update, and pr_description.",
    ),
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
    .describe(
      "Human-readable label, e.g. 'PR #284 — Implement payment retry'.",
    ),
  likelihood: z
    .number()
    .int()
    .min(0)
    .max(100)
    .describe("How likely this change caused the incident, 0-100."),
  rationale: z
    .string()
    .describe(
      "Why this change is (or isn't) a strong suspect, grounded in evidence.",
    ),
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
    .describe(
      "One concise first-screen headline for an on-call engineer. Name the suspected change and failure mechanism when known; avoid implementation minutiae better suited to reasoning.",
    ),
  reasoning: z
    .string()
    .describe(
      "The deeper chain of reasoning that links the stack trace to the suspected change(s), citing the evidence gathered. This can be longer than the summary.",
    ),
  analysis: analysisSchema.describe(
    "Structured data for the incident overview UI. This must be grounded in tool output and should not introduce facts absent from summary/reasoning/evidence.",
  ),
  fixHandoff: fixHandoffSchema
    .nullable()
    .describe(
      "First-class fix handoff for engineers: proof, fix plan, validation plan, and copy-ready artifacts. This must be grounded in the same evidence as the analysis and suspects. Use null only when the evidence is too thin to assemble a useful handoff.",
    ),
  suspects: z
    .array(reportSuspectSchema)
    .describe(
      "Candidate changes, ranked implicitly by likelihood (highest first).",
    ),
  suggestedFixes: z
    .array(suggestedFixSchema)
    .describe("One to three concrete, actionable fixes."),
  evidence: z
    .array(z.string())
    .describe(
      "Short factual bullet points that support the conclusion. Each item should stand alone in the UI and cite a concrete signal such as file, line, PR, timing, log, patch, or similar incident.",
    ),
});

export type InvestigationReport = z.infer<typeof investigationReportSchema>;
export type ReportSuspect = z.infer<typeof reportSuspectSchema>;

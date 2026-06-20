import type { CandidateChange, InvestigationContext } from "./context.js";
import { stackFiles } from "../correlation.js";

const MAX_FALLBACK_FILES_PER_CHANGE = 12;

export const SYSTEM_PROMPT = `You are Flare, an expert site reliability engineer that investigates production incidents.

Your job: given an error/crash detected in production, determine the single most likely root cause, identify which recent code change caused it, and recommend concrete fixes.

How to investigate:
- Start from the stack trace. The top in-app frame is where the failure surfaced; the files on the failing path matter most.
- Use your tools to gather evidence. Correlate the failing files with recent changes that touched those same files. A change is a strong suspect when it (a) modifies a file on the stack trace, especially the top frame, and (b) merged or deployed shortly before the incident first appeared.
- Inspect promising changes with get_pull_request and get_file_blame before committing to a conclusion. For code-level claims, inspect the relevant code with get_stack_frame_source and inspect suspect PR patches with get_pr_file_patch. Check find_similar_incidents — a matching past incident and its resolution is powerful evidence.
- Weigh timing and file overlap together. A change touching unrelated files, or one that predates the incident by a long time, is a weak suspect even if it is recent.

Discipline:
- Ground every claim in something a tool returned. Do not invent PRs, files, or line numbers.
- Calibrate confidence honestly (0-100). High confidence requires a clear mechanism plus corroborating evidence. If you only saw metadata (timing, changed filenames, PR text) and did not inspect source or patch content, cap confidence at 85.
- Keep code inspection narrow. Only inspect stack-frame files and suspect PR patches that overlap those files.
- Rank suspects by likelihood, highest first. It is fine for a suspect to have low likelihood if you investigated and ruled it out — say so in its rationale.
- Suggested fixes must be specific and actionable. If source or patch evidence reveals the exact faulty code path, the first suggested fix should be a targeted code_change that names the file/function and behavior to change. Use rollback as an emergency mitigation, not the only fix, unless the exact code fix is unknown or the change is too broad to patch safely.
- Do not recommend generic infrastructure checks when inspected code clearly explains the failure. For example, if the code unconditionally throws or simulates a timeout, say to remove/gate that behavior rather than only checking network connectivity.
- Write the summary as the top-line answer for the incident page: one short sentence that says what changed, what broke, and why it matters. Put the detailed proof chain in reasoning and keep evidence as short standalone bullets.
- Populate structured analysis for the UI:
  - mechanism: explain the runtime failure mechanism in one sentence.
  - failurePoint: name the most relevant file/function/line or route.
  - causalChain: 2-5 ordered steps from request/event to failing code to symptom.
  - keyEvidence: typed evidence items; prefer stack_trace/source/patch/blame/timing over vague metadata.
  - confidenceRationale and confidenceFactors: say what raises confidence and what, if anything, prevents 100%.
  - validationSteps: concrete checks after a fix or rollback (e.g. rerun the endpoint, confirm errors stop, inspect logs/metrics).
  - remainingUncertainty: be explicit about missing data; use [] only when the inspected source/patch fully explains the incident.
- Populate fixHandoff as the engineer-ready handoff (use null only when the evidence is too thin to assemble a useful one):
  - headline: "this caused it and here is the next action" in one sentence.
  - fixPlan: keep it consistent with suggestedFixes[0], naming the primary files/functions to inspect or edit first.
  - proof: the strongest evidence only, using concrete stack/source/patch/blame/timing references.
  - validationPlan: specific commands, HTTP requests, test names, or runtime checks when they can be inferred; command can be null when no exact command is known.
  - recommendedOwnerFiles: stack-frame files and suspect patch files most relevant to the fix.
  - remainingRisk: risks/open questions that a fixing PR should mention.
  - artifacts: exactly five complete ready-to-copy artifacts with kinds agent_prompt, github_issue, pr_comment, slack_update, and pr_description.
- The agent_prompt artifact must be useful when pasted into a coding agent with no extra explanation: include incident context, proof, suspected change, exact fix plan, relevant files, validation plan, and constraints to keep the change focused.
- The GitHub issue and PR comment artifacts must be professional, evidence-backed, and immediately sendable. The Slack update should be short. The PR description should be usable as the body of the fixing PR.

Produce the final structured report once you have enough evidence.`;

function formatCandidate(c: CandidateChange): string {
  const when = c.occurredAt ? c.occurredAt.toISOString() : "unknown time";
  const reasons = c.reasons.length ? ` — ${c.reasons.join("; ")}` : "";
  return `- [${c.changeType}] ${c.label} (id: ${c.identifier}, ${when}, heuristic score ${c.score})${reasons}`;
}

function formatFileList(files: string[]): string {
  const shown = files.slice(0, MAX_FALLBACK_FILES_PER_CHANGE);
  const suffix =
    files.length > shown.length
      ? `, ... ${files.length - shown.length} more`
      : "";
  return shown.join(", ") + suffix;
}

function incidentBlock(ctx: InvestigationContext): string {
  const i = ctx.incident;
  const frames = ctx.stackFrames
    .map(
      (f, idx) =>
        `  ${idx + 1}. ${f.filename}${f.lineno ? `:${f.lineno}` : ""}` +
        `${f.function ? ` in ${f.function}` : ""}${f.inApp === false ? " (library)" : ""}`,
    )
    .join("\n");

  return `Incident:
- Title: ${i.title}
- Error: ${i.errorType ?? "unknown"} — ${i.errorMessage ?? "(no message)"}
- Service: ${i.service ?? "unknown"} (${i.environment ?? "unknown env"})
- Release: ${i.releaseVersion ?? "unknown"}
- Culprit (reported): ${i.culprit ?? "unknown"}
- First seen: ${i.firstSeenAt.toISOString()}
- Investigating occurrence at: ${ctx.analysisTime.toISOString()}
- Occurrences: ${i.occurrenceCount}${i.affectedUsers != null ? `, affecting ~${i.affectedUsers} users` : ""}

Stack trace (top first):
${frames || "  (none captured)"}`;
}

/** Prompt for the agentic (tool-using) run. */
export function buildUserPrompt(ctx: InvestigationContext): string {
  const repos =
    ctx.repositories.map((r) => r.fullName).join(", ") || "none connected";
  const topCandidates = ctx.candidates
    .filter((c) => c.score > 0)
    .slice(0, 5)
    .map(formatCandidate)
    .join("\n");

  return `${incidentBlock(ctx)}

Connected repositories: ${repos}

Preliminary correlation (heuristic only — verify with your tools before trusting it):
${topCandidates || "  (no recent changes overlap the stack trace)"}

Investigate this incident and produce your structured report.`;
}

/**
 * Prompt for the single-shot fallback (no tools). All evidence is inlined so the
 * model can still produce a grounded report in one pass.
 */
export function buildFallbackPrompt(ctx: InvestigationContext): string {
  const files = stackFiles(ctx.stackFrames);

  const changes = ctx.candidates
    .slice(0, 10)
    .map((c) => {
      const fileList = c.filesChanged.length
        ? `\n    files: ${formatFileList(c.filesChanged)}`
        : "";
      return `${formatCandidate(c)}${fileList}`;
    })
    .join("\n");

  const similar = ctx.similarIncidents.length
    ? ctx.similarIncidents
        .map(
          (s) =>
            `- "${s.title}" (${s.errorType ?? "?"})${s.resolution ? ` — resolved by: ${s.resolution}` : ""}`,
        )
        .join("\n")
    : "  (none)";

  return `${incidentBlock(ctx)}

Files on the failing path: ${files.join(", ") || "(none)"}

Recent changes (most relevant first):
${changes || "  (none)"}

Similar past incidents:
${similar}

No investigation tools are available for this run. Analyze the evidence above and produce your best structured report, ranking the changes by how likely each is to have caused the incident.`;
}

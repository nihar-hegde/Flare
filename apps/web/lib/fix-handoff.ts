import type { IncidentDetail, Investigation } from "@/lib/api";
import {
  extractCodeEvidence,
  type DiffRow,
  type PatchEvidence,
  type SourceEvidence,
} from "@/lib/evidence";

const MAX_STACK_FRAMES = 8;
const MAX_EVIDENCE_ITEMS = 8;
const MAX_FIXES = 3;
const MAX_SOURCE_WINDOWS = 2;
const MAX_PATCHES = 2;
const MAX_SNIPPET_CHARS = 3_500;
const ARTIFACT_ORDER: HandoffArtifactKind[] = [
  "agent_prompt",
  "github_issue",
  "pr_comment",
  "slack_update",
  "pr_description",
];

export type HandoffArtifactKind =
  | "agent_prompt"
  | "github_issue"
  | "pr_comment"
  | "slack_update"
  | "pr_description";

export interface HandoffArtifact {
  kind: HandoffArtifactKind;
  title: string;
  description: string;
  body: string;
}

export interface FixHandoff {
  headline: string;
  confidence: number | null;
  suspect: {
    label: string;
    likelihood: number;
    url: string | null;
  } | null;
  primaryFix: {
    title: string;
    action: string;
    detail: string;
  } | null;
  proof: string[];
  validation: string[];
  recommendedOwnerFiles: string[];
  remainingRisk: string[];
  artifacts: HandoffArtifact[];
}

interface BuilderInput {
  incident: IncidentDetail;
  investigation: Investigation;
}

export function buildFixHandoff(input: BuilderInput): FixHandoff {
  if (input.investigation.fixHandoff) {
    return buildStoredFixHandoff(input);
  }

  return buildDerivedFixHandoff(input);
}

function buildDerivedFixHandoff(input: BuilderInput): FixHandoff {
  const { incident, investigation } = input;
  const analysis = investigation.analysis;
  const topSuspect = incident.suspects[0] ?? null;
  const primaryFix = investigation.suggestedFixes[0] ?? null;
  const proof = buildProof(investigation);
  const validation = analysis?.validationSteps.length
    ? analysis.validationSteps
    : fallbackValidation(incident);
  const headline =
    investigation.summary ??
    investigation.rootCause ??
    "Flare completed the investigation and prepared a fix handoff.";

  return {
    headline,
    confidence: investigation.confidence,
    suspect: topSuspect
      ? {
          label: topSuspect.label,
          likelihood: topSuspect.likelihood,
          url: topSuspect.change?.url ?? null,
        }
      : null,
    primaryFix: primaryFix
      ? {
          title: primaryFix.title,
          action: primaryFix.action,
          detail: primaryFix.detail,
        }
      : null,
    proof,
    validation,
    recommendedOwnerFiles: [],
    remainingRisk: investigation.analysis?.remainingUncertainty ?? [],
    artifacts: [
      {
        kind: "agent_prompt",
        title: "Agent Prompt",
        description: "Paste into Codex, Cursor, or another coding agent.",
        body: buildAgentFixPrompt(input),
      },
      {
        kind: "github_issue",
        title: "GitHub Issue",
        description: "Ready-to-file issue for tracking the fix.",
        body: buildGithubIssueBody(input),
      },
      {
        kind: "pr_comment",
        title: "PR Comment",
        description: "Comment for the likely suspect PR.",
        body: buildPrCommentBody(input),
      },
      {
        kind: "slack_update",
        title: "Slack Update",
        description: "Short team update for incident channels.",
        body: buildSlackUpdate(input),
      },
      {
        kind: "pr_description",
        title: "PR Description",
        description: "Template for the fixing pull request.",
        body: buildPrDescription(input),
      },
    ],
  };
}

function buildStoredFixHandoff(input: BuilderInput): FixHandoff {
  const stored = input.investigation.fixHandoff;
  if (!stored) return buildDerivedFixHandoff(input);

  const derived = buildDerivedFixHandoff(input);
  const proof = stored.proof.map(formatEvidenceItem).filter(Boolean);
  const validation = stored.validationPlan.map(formatValidationStep);

  return {
    headline: stored.headline || derived.headline,
    confidence: derived.confidence,
    suspect: derived.suspect,
    primaryFix: {
      title: stored.fixPlan.title,
      action: stored.fixPlan.action,
      detail: stored.fixPlan.detail,
    },
    proof: proof.length ? proof : derived.proof,
    validation: validation.length ? validation : derived.validation,
    recommendedOwnerFiles: stored.recommendedOwnerFiles.length
      ? stored.recommendedOwnerFiles
      : stored.fixPlan.targetFiles,
    remainingRisk: stored.remainingRisk.length
      ? stored.remainingRisk
      : derived.remainingRisk,
    artifacts: mergeArtifacts(stored.artifacts, derived.artifacts),
  };
}

export function buildAgentFixPrompt({
  incident,
  investigation,
}: BuilderInput): string {
  const analysis = investigation.analysis;
  const topSuspect = incident.suspects[0] ?? null;
  const topFrame = topApplicationFrame(incident.latestEvent?.stackTrace ?? []);
  const codeEvidence = extractCodeEvidence(investigation.steps);
  const primaryFix = investigation.suggestedFixes[0] ?? null;

  return joinSections([
    "# Fix this incident",
    [
      "You are a coding agent working on the affected service repository.",
      "Use the context below to implement the smallest correct fix, add or update focused tests where the repo supports them, and run the relevant verification commands before finishing.",
      "Do not refactor unrelated code.",
    ].join("\n"),
    section(
      "Incident",
      compactLines([
        line("Title", incident.title),
        line("Service", incident.service),
        line("Environment", incident.environment),
        line("Release", incident.releaseVersion),
        line("Severity", incident.severity),
        line("Occurrences", String(incident.occurrenceCount)),
        line("Affected users", nullableNumber(incident.affectedUsers)),
        line("First seen", incident.firstSeenAt),
        line("Error type", incident.errorType),
        line("Error message", incident.errorMessage),
        line("Reported culprit", incident.culprit),
        line("Top frame", topFrame ? formatFrame(topFrame) : null),
      ]).join("\n"),
    ),
    section(
      "Root cause analysis",
      compactLines([
        line("Summary", investigation.summary),
        line("Root cause", investigation.rootCause),
        line("Mechanism", analysis?.mechanism),
        line("Failure point", analysis?.failurePoint),
        line("Confidence", confidenceText(investigation)),
      ]).join("\n"),
    ),
    topSuspect
      ? section(
          "Primary suspect",
          compactLines([
            line("Change", topSuspect.label),
            line("Likelihood", `${topSuspect.likelihood}%`),
            line("Type", topSuspect.changeType),
            line("URL", topSuspect.change?.url ?? null),
            line("Rationale", topSuspect.rationale),
          ]).join("\n"),
        )
      : null,
    analysis?.causalChain.length
      ? section("Causal chain", ordered(analysis.causalChain.map(formatLink)))
      : null,
    section("Evidence", bullets(buildProof(investigation))),
    section(
      "Suggested fix",
      primaryFix
        ? [
            line("Primary action", `${primaryFix.title} (${primaryFix.action})`),
            primaryFix.detail,
            investigation.suggestedFixes.length > 1
              ? [
                  "",
                  "Other suggested fixes:",
                  bullets(
                    investigation.suggestedFixes
                      .slice(1, MAX_FIXES)
                      .map((fix) => `${fix.title} (${fix.action}): ${fix.detail}`),
                  ),
                ].join("\n")
              : null,
          ]
            .filter(Boolean)
            .join("\n")
        : "No suggested fix was recorded. Infer the smallest fix from the root cause and evidence.",
    ),
    section("Validation", bullets(validationSteps({ incident, investigation }))),
    investigation.analysis?.remainingUncertainty.length
      ? section("Known uncertainty", bullets(investigation.analysis.remainingUncertainty))
      : null,
    stackTraceSection(incident),
    codeContextSection(codeEvidence.sources, codeEvidence.patches),
    section(
      "Implementation instructions",
      ordered([
        "Inspect the named files and confirm the failing path before editing.",
        "Make the smallest code change that removes the incident mechanism while preserving intended behavior.",
        "Add or update a focused regression test when the repo has a test harness.",
        "Run the relevant typecheck, lint, and test commands available in the repo.",
        "Report the files changed, verification run, and any remaining risk.",
      ]),
    ),
  ]);
}

function buildGithubIssueBody({ incident, investigation }: BuilderInput): string {
  return joinSections([
    `# Flare: ${incident.title}`,
    section(
      "Summary",
      investigation.summary ??
        investigation.rootCause ??
        "Flare identified a likely production regression.",
    ),
    section(
      "Root Cause",
      compactLines([
        investigation.rootCause,
        investigation.analysis?.mechanism,
        line("Failure point", investigation.analysis?.failurePoint),
        line("Confidence", confidenceText(investigation)),
      ]).join("\n"),
    ),
    suspectSection(incident),
    section("Evidence", bullets(buildProof(investigation))),
    section("Suggested Fix", suggestedFixText(investigation)),
    section("Validation", bullets(validationSteps({ incident, investigation }))),
  ]);
}

function buildPrCommentBody({ incident, investigation }: BuilderInput): string {
  return joinSections([
    "## Flare linked this change to a production incident",
    compactLines([
      line("Incident", incident.title),
      line("Confidence", confidenceText(investigation)),
      line("Root cause", investigation.rootCause),
      line("Failure point", investigation.analysis?.failurePoint),
    ]).join("\n"),
    section("Why this change", incident.suspects[0]?.rationale ?? null),
    section("Evidence", bullets(buildProof(investigation).slice(0, 5))),
    section("Suggested fix", suggestedFixText(investigation)),
    section("Validation", bullets(validationSteps({ incident, investigation }))),
  ]);
}

function buildSlackUpdate({ incident, investigation }: BuilderInput): string {
  const topSuspect = incident.suspects[0] ?? null;
  return compactLines([
    `Flare found a likely root cause for *${incident.title}*.`,
    line("Confidence", confidenceText(investigation)),
    line("Suspect", topSuspect ? `${topSuspect.label} (${topSuspect.likelihood}%)` : null),
    line("Root cause", investigation.rootCause ?? investigation.summary),
    line("Fix", investigation.suggestedFixes[0]?.title ?? null),
    "Validation:",
    bullets(validationSteps({ incident, investigation }).slice(0, 3)),
  ]).join("\n");
}

function buildPrDescription({ incident, investigation }: BuilderInput): string {
  return joinSections([
    "# Summary",
    bullets([
      investigation.suggestedFixes[0]?.title ??
        "Fix the incident mechanism identified by Flare.",
      investigation.rootCause ?? investigation.summary ?? "",
    ]),
    section(
      "Incident Context",
      compactLines([
        line("Incident", incident.title),
        line("Service", incident.service),
        line("Environment", incident.environment),
        line("Failure point", investigation.analysis?.failurePoint),
        line("Confidence", confidenceText(investigation)),
      ]).join("\n"),
    ),
    section("Evidence", bullets(buildProof(investigation).slice(0, 5))),
    section("Validation Plan", bullets(validationSteps({ incident, investigation }))),
    section(
      "Risk",
      investigation.analysis?.remainingUncertainty.length
        ? bullets(investigation.analysis.remainingUncertainty)
        : "Low, assuming the fix is scoped to the identified failing path and validation passes.",
    ),
  ]);
}

function buildProof(investigation: Investigation): string[] {
  const structured =
    investigation.analysis?.keyEvidence.map(formatEvidenceItem) ?? [];
  return [...structured, ...investigation.evidence]
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, MAX_EVIDENCE_ITEMS);
}

function validationSteps({ incident, investigation }: BuilderInput): string[] {
  if (investigation.analysis?.validationSteps.length) {
    return investigation.analysis.validationSteps;
  }
  return fallbackValidation(incident);
}

function fallbackValidation(incident: IncidentDetail): string[] {
  return [
    "Run the affected request path or reproduction case and confirm it succeeds.",
    "Confirm no new events appear for this incident fingerprint after the fix.",
    incident.latestEvent?.stackTrace?.[0]
      ? `Confirm the stack no longer reaches ${formatFrame(incident.latestEvent.stackTrace[0])}.`
      : "Run the relevant automated tests, typecheck, and lint commands.",
  ];
}

function suggestedFixText(investigation: Investigation): string {
  if (!investigation.suggestedFixes.length) {
    return "No suggested fix was recorded. Use the root cause and evidence to make the smallest safe change.";
  }
  return bullets(
    investigation.suggestedFixes
      .slice(0, MAX_FIXES)
      .map((fix) => `${fix.title} (${fix.action}): ${fix.detail}`),
  );
}

function suspectSection(incident: IncidentDetail): string | null {
  const suspect = incident.suspects[0];
  if (!suspect) return null;
  return section(
    "Likely Suspect",
    compactLines([
      line("Change", suspect.label),
      line("Likelihood", `${suspect.likelihood}%`),
      line("URL", suspect.change?.url ?? null),
      line("Rationale", suspect.rationale),
    ]).join("\n"),
  );
}

function section(title: string, body: string | null): string | null {
  if (!body?.trim()) return null;
  return `## ${title}\n${body.trim()}`;
}

function joinSections(sections: Array<string | null>): string {
  return sections.filter(Boolean).join("\n\n");
}

function line(
  label: string,
  value: string | number | null | undefined,
): string | null {
  if (value == null || value === "") return null;
  return `- ${label}: ${value}`;
}

function compactLines(lines: Array<string | null | undefined>): string[] {
  return lines.filter((item): item is string => Boolean(item));
}

function bullets(items: string[]): string {
  const shown = items.map((item) => item.trim()).filter(Boolean);
  return shown.length ? shown.map((item) => `- ${item}`).join("\n") : "- None";
}

function ordered(items: string[]): string {
  const shown = items.map((item) => item.trim()).filter(Boolean);
  return shown.length
    ? shown.map((item, index) => `${index + 1}. ${item}`).join("\n")
    : "1. None";
}

function nullableNumber(value: number | null): string | null {
  return value == null ? null : String(value);
}

function confidenceText(investigation: Investigation): string | null {
  if (investigation.confidence == null) return null;
  const rationale = investigation.analysis?.confidenceRationale;
  return `${investigation.confidence}%${rationale ? ` - ${rationale}` : ""}`;
}

function formatLink(link: { title: string; detail: string }): string {
  return `${link.title}: ${link.detail}`;
}

function formatEvidenceItem(
  item: { title: string; detail: string; reference: string | null },
): string {
  const reference = item.reference ? ` [${item.reference}]` : "";
  return `${item.title}${reference}: ${item.detail}`;
}

function formatValidationStep(
  step: NonNullable<Investigation["fixHandoff"]>["validationPlan"][number],
): string {
  return compactLines([
    step.title,
    step.command ? `Command: ${step.command}` : null,
    `Expected: ${step.expectedOutcome}`,
  ]).join(" - ");
}

function mergeArtifacts(
  preferred: HandoffArtifact[],
  fallback: HandoffArtifact[],
): HandoffArtifact[] {
  const byKind = new Map<HandoffArtifactKind, HandoffArtifact>();

  for (const artifact of fallback) {
    byKind.set(artifact.kind, artifact);
  }

  for (const artifact of preferred) {
    if (artifact.body.trim()) {
      byKind.set(artifact.kind, artifact);
    }
  }

  return ARTIFACT_ORDER.map((kind) => byKind.get(kind)).filter(
    (artifact): artifact is HandoffArtifact => Boolean(artifact),
  );
}

function topApplicationFrame(
  frames: NonNullable<IncidentDetail["latestEvent"]>["stackTrace"],
) {
  return frames.find((frame) => frame.inApp !== false) ?? frames[0] ?? null;
}

function formatFrame(
  frame: NonNullable<IncidentDetail["latestEvent"]>["stackTrace"][number],
): string {
  const lineNumber = frame.lineno ? `:${frame.lineno}` : "";
  const columnNumber = frame.colno ? `:${frame.colno}` : "";
  const fn = frame.function ? ` in ${frame.function}` : "";
  return `${frame.filename}${lineNumber}${columnNumber}${fn}`;
}

function stackTraceSection(incident: IncidentDetail): string | null {
  const frames = incident.latestEvent?.stackTrace ?? [];
  if (!frames.length) return null;
  return section(
    "Stack trace",
    ordered(frames.slice(0, MAX_STACK_FRAMES).map(formatFrame)),
  );
}

function codeContextSection(
  sources: SourceEvidence[],
  patches: PatchEvidence[],
): string | null {
  const blocks = [
    ...sources.slice(0, MAX_SOURCE_WINDOWS).map(sourceBlock),
    ...patches.slice(0, MAX_PATCHES).map(patchBlock),
  ];
  return section("Code context", blocks.filter(Boolean).join("\n\n"));
}

function sourceBlock(source: SourceEvidence): string {
  const location = `${source.path}${source.targetLine ? `:${source.targetLine}` : ""}`;
  const lines = source.lines
    .map((line) =>
      line.number == null
        ? line.text
        : `${String(line.number).padStart(4, " ")} | ${line.text}`,
    )
    .join("\n");
  return [
    `Source window: ${location}`,
    source.url ? `URL: ${source.url}` : null,
    fenced("text", truncate(lines, MAX_SNIPPET_CHARS)),
  ]
    .filter(Boolean)
    .join("\n");
}

function patchBlock(patch: PatchEvidence): string {
  const title = `Patch${patch.prNumber ? ` from PR #${patch.prNumber}` : ""}: ${patch.path}`;
  return [
    title,
    patch.url ? `URL: ${patch.url}` : null,
    fenced("diff", truncate(renderPatchRows(patch.rows), MAX_SNIPPET_CHARS)),
  ]
    .filter(Boolean)
    .join("\n");
}

function renderPatchRows(rows: DiffRow[]): string {
  return rows
    .map((row) => {
      if (row.kind === "hunk") return row.text;
      if (row.kind === "add") return `+${row.text}`;
      if (row.kind === "del") return `-${row.text}`;
      return ` ${row.text}`;
    })
    .join("\n");
}

function fenced(language: string, value: string): string {
  // Four backticks so snippets that themselves contain ``` fences don't break out.
  return `\`\`\`\`${language}\n${value}\n\`\`\`\``;
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 80)}\n... [truncated for handoff]`;
}

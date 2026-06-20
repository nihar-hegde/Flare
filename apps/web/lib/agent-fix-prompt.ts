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

export function buildAgentFixPrompt({
  incident,
  investigation,
}: {
  incident: IncidentDetail;
  investigation: Investigation;
}): string {
  const analysis = investigation.analysis;
  const topSuspect = incident.suspects[0] ?? null;
  const topFrame = topApplicationFrame(incident.latestEvent?.stackTrace ?? []);
  const codeEvidence = extractCodeEvidence(investigation.steps);
  const primaryFix = investigation.suggestedFixes[0] ?? null;

  const sections = [
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
        line(
          "Confidence",
          investigation.confidence == null
            ? null
            : `${investigation.confidence}%${
                analysis?.confidenceRationale
                  ? ` - ${analysis.confidenceRationale}`
                  : ""
              }`,
        ),
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
    section(
      "Evidence",
      bullets([
        ...(analysis?.keyEvidence.map(formatEvidenceItem) ?? []),
        ...investigation.evidence,
      ].slice(0, MAX_EVIDENCE_ITEMS)),
    ),
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
    analysis?.validationSteps.length
      ? section("Validation", bullets(analysis.validationSteps))
      : null,
    analysis?.remainingUncertainty.length
      ? section("Known uncertainty", bullets(analysis.remainingUncertainty))
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
  ];

  return sections.filter(Boolean).join("\n\n");
}

function section(title: string, body: string | null): string | null {
  if (!body?.trim()) return null;
  return `## ${title}\n${body.trim()}`;
}

function line(label: string, value: string | number | null | undefined): string | null {
  if (value == null || value === "") return null;
  return `- ${label}: ${value}`;
}

function compactLines(lines: Array<string | null>): string[] {
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

function formatLink(link: { title: string; detail: string }): string {
  return `${link.title}: ${link.detail}`;
}

function formatEvidenceItem(
  item: NonNullable<Investigation["analysis"]>["keyEvidence"][number],
): string {
  const reference = item.reference ? ` [${item.reference}]` : "";
  return `${item.title}${reference}: ${item.detail}`;
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
  return `\`\`\`\`${language}\n${value}\n\`\`\`\``;
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 80)}\n... [truncated for agent prompt]`;
}

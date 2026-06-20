import type {
  ActivityLog,
  AgentStep,
  FixHandoff,
  Incident,
  IncidentSuspect,
  Investigation,
  InvestigationAnalysis,
  StackFrame,
  SuggestedFix,
} from "@repo/db";
import type {
  IncidentDetailRow,
  IncidentListRow,
} from "../services/incidents.js";
import { toRepoRelativePath } from "../services/github-sync.js";

// JSON has no Date type — serialize timestamps to ISO strings so the response
// shape matches exactly what the client receives over the wire.
const iso = (date: Date | null | undefined): string | null =>
  date ? date.toISOString() : null;

// Display-only path shortening for stack frames / culprit: repo-relative when
// the file resolves inside the connected repo, the package-relative tail for
// node_modules, otherwise the original. The raw absolute path stays in the
// stored event so the agent's GitHub lookups keep working.
function displayPath(filename: string): string {
  const repoRelative = toRepoRelativePath(filename);
  if (repoRelative) return repoRelative;
  const normalized = filename.replace(/\\/g, "/");
  const nm = normalized.lastIndexOf("/node_modules/");
  if (nm >= 0) return normalized.slice(nm + "/node_modules/".length);
  return filename;
}

function displayCulprit(culprit: string | null): string | null {
  if (!culprit) return null;
  const shorten = (loc: string): string => {
    const match = loc.match(/^(.*?)(:\d+(?::\d+)?)?$/);
    const path = match?.[1] ?? loc;
    if (!path.includes("/")) return loc;
    return `${displayPath(path)}${match?.[2] ?? ""}`;
  };
  return culprit.includes("(")
    ? culprit.replace(
        /\(([^)]*)\)/,
        (_full, inner: string) => `(${shorten(inner)})`,
      )
    : shorten(culprit);
}

// ─────────────────────────────────────────────────────────────
// Response DTOs
// ─────────────────────────────────────────────────────────────
export interface InvestigationSummary {
  id: string;
  status: Investigation["status"];
  confidence: number | null;
  rootCause: string | null;
}

export interface TopSuspect {
  label: string;
  likelihood: number;
  changeType: IncidentSuspect["changeType"];
}

export interface IncidentListItem {
  id: string;
  title: string;
  service: string | null;
  environment: string | null;
  severity: Incident["severity"];
  status: Incident["status"];
  errorType: string | null;
  errorMessage: string | null;
  releaseVersion: string | null;
  occurrenceCount: number;
  affectedUsers: number | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  latestInvestigation: InvestigationSummary | null;
  topSuspect: TopSuspect | null;
}

export type SuspectChange =
  | {
      type: "pull_request";
      number: number;
      title: string;
      url: string | null;
      author: string | null;
    }
  | {
      type: "commit";
      sha: string;
      message: string | null;
      url: string | null;
      author: string | null;
    }
  | {
      type: "deployment";
      releaseVersion: string | null;
      environment: string | null;
      url: string | null;
    }
  | null;

export interface IncidentSuspectDto {
  id: string;
  changeType: IncidentSuspect["changeType"];
  label: string;
  likelihood: number;
  rank: number | null;
  rationale: string | null;
  change: SuspectChange;
}

export interface FixPrInfo {
  url: string | null;
  number: number | null;
  draft: boolean;
  applied: boolean;
}

export interface InvestigationDto {
  id: string;
  status: Investigation["status"];
  rootCause: string | null;
  confidence: number | null;
  summary: string | null;
  reasoning: string | null;
  analysis: InvestigationAnalysis | null;
  fixHandoff: FixHandoff | null;
  suggestedFixes: SuggestedFix[];
  evidence: string[];
  steps: AgentStep[];
  // The fix PR already opened for this investigation, if any (so the UI reflects
  // it on load instead of offering to open a duplicate).
  fixPr: FixPrInfo | null;
  model: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string | null;
}

export interface IncidentEventDto {
  id: string;
  occurredAt: string | null;
  receivedAt: string | null;
  stackTrace: StackFrame[];
}

export interface ActivityDto {
  id: string;
  type: ActivityLog["type"];
  message: string | null;
  actor: string;
  createdAt: string | null;
}

export interface IncidentDetail {
  id: string;
  title: string;
  service: string | null;
  environment: string | null;
  severity: Incident["severity"];
  status: Incident["status"];
  errorType: string | null;
  errorMessage: string | null;
  culprit: string | null;
  fingerprint: string | null;
  externalId: string | null;
  releaseVersion: string | null;
  permalink: string | null;
  occurrenceCount: number;
  affectedUsers: number | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  resolvedAt: string | null;
  resolution: string | null;
  createdAt: string | null;
  latestEvent: IncidentEventDto | null;
  investigation: InvestigationDto | null;
  suspects: IncidentSuspectDto[];
  timeline: ActivityDto[];
}

// ─────────────────────────────────────────────────────────────
// Serializers
// ─────────────────────────────────────────────────────────────
export function serializeIncidentListItem(
  row: IncidentListRow,
): IncidentListItem {
  const investigation = row.investigations[0] ?? null;
  const suspect = row.suspects[0] ?? null;

  return {
    id: row.id,
    title: row.title,
    service: row.service,
    environment: row.environment,
    severity: row.severity,
    status: row.status,
    errorType: row.errorType,
    errorMessage: row.errorMessage,
    releaseVersion: row.releaseVersion,
    occurrenceCount: row.occurrenceCount,
    affectedUsers: row.affectedUsers,
    firstSeenAt: iso(row.firstSeenAt),
    lastSeenAt: iso(row.lastSeenAt),
    latestInvestigation: investigation
      ? {
          id: investigation.id,
          status: investigation.status,
          confidence: investigation.confidence,
          rootCause: investigation.rootCause,
        }
      : null,
    topSuspect: suspect
      ? {
          label: suspect.label,
          likelihood: suspect.likelihood,
          changeType: suspect.changeType,
        }
      : null,
  };
}

function serializeChange(
  suspect: IncidentDetailRow["suspects"][number],
): SuspectChange {
  if (suspect.pullRequest) {
    const pr = suspect.pullRequest;
    return {
      type: "pull_request",
      number: pr.number,
      title: pr.title,
      url: pr.url,
      author: pr.author,
    };
  }
  if (suspect.commit) {
    const commit = suspect.commit;
    return {
      type: "commit",
      sha: commit.sha,
      message: commit.message,
      url: commit.url,
      author: commit.author,
    };
  }
  if (suspect.deployment) {
    const deployment = suspect.deployment;
    return {
      type: "deployment",
      releaseVersion: deployment.releaseVersion,
      environment: deployment.environment,
      url: deployment.url,
    };
  }
  return null;
}

function serializeSuspect(
  suspect: IncidentDetailRow["suspects"][number],
): IncidentSuspectDto {
  return {
    id: suspect.id,
    changeType: suspect.changeType,
    label: suspect.label,
    likelihood: suspect.likelihood,
    rank: suspect.rank,
    rationale: suspect.rationale,
    change: serializeChange(suspect),
  };
}

/** The most recent fix PR opened for this investigation, from the activity log. */
function findFixPr(
  activity: IncidentDetailRow["activity"],
  investigationId: string,
): FixPrInfo | null {
  const entry = activity.find((row) => {
    const meta = row.metadata as Record<string, unknown> | null;
    return (
      row.type === "notified" &&
      meta?.["kind"] === "draft_pr" &&
      meta["investigationId"] === investigationId
    );
  });
  if (!entry) return null;

  const meta = (entry.metadata ?? {}) as Record<string, unknown>;
  return {
    url: typeof meta["url"] === "string" ? meta["url"] : null,
    number: typeof meta["number"] === "number" ? meta["number"] : null,
    draft: meta["draft"] === true,
    applied: meta["applied"] === true,
  };
}

function serializeInvestigation(
  investigation: IncidentDetailRow["investigations"][number],
  activity: IncidentDetailRow["activity"],
): InvestigationDto {
  return {
    id: investigation.id,
    status: investigation.status,
    rootCause: investigation.rootCause,
    confidence: investigation.confidence,
    summary: investigation.summary,
    reasoning: investigation.reasoning,
    analysis: investigation.analysis ?? null,
    fixHandoff: investigation.fixHandoff ?? null,
    suggestedFixes: investigation.suggestedFixes ?? [],
    evidence: investigation.evidence ?? [],
    steps: investigation.steps ?? [],
    fixPr: findFixPr(activity, investigation.id),
    model: investigation.model,
    startedAt: iso(investigation.startedAt),
    completedAt: iso(investigation.completedAt),
    createdAt: iso(investigation.createdAt),
  };
}

export function serializeIncidentDetail(
  row: IncidentDetailRow,
): IncidentDetail {
  const latestEvent = row.events[0] ?? null;
  const investigation = row.investigations[0] ?? null;

  return {
    id: row.id,
    title: row.title,
    service: row.service,
    environment: row.environment,
    severity: row.severity,
    status: row.status,
    errorType: row.errorType,
    errorMessage: row.errorMessage,
    culprit: displayCulprit(row.culprit),
    fingerprint: row.fingerprint,
    externalId: row.externalId,
    releaseVersion: row.releaseVersion,
    permalink: row.permalink,
    occurrenceCount: row.occurrenceCount,
    affectedUsers: row.affectedUsers,
    firstSeenAt: iso(row.firstSeenAt),
    lastSeenAt: iso(row.lastSeenAt),
    resolvedAt: iso(row.resolvedAt),
    resolution: row.resolution,
    createdAt: iso(row.createdAt),
    latestEvent: latestEvent
      ? {
          id: latestEvent.id,
          occurredAt: iso(latestEvent.occurredAt),
          receivedAt: iso(latestEvent.receivedAt),
          stackTrace: (latestEvent.stackTrace ?? []).map((frame) => ({
            ...frame,
            filename: displayPath(frame.filename),
          })),
        }
      : null,
    investigation: investigation
      ? serializeInvestigation(investigation, row.activity)
      : null,
    suspects: row.suspects.map(serializeSuspect),
    timeline: row.activity.map((entry) => ({
      id: entry.id,
      type: entry.type,
      message: entry.message,
      actor: entry.actor,
      createdAt: iso(entry.createdAt),
    })),
  };
}

import type { Commit, Deployment, PullRequest, StackFrame } from "@repo/db";
import type { CandidateChange } from "./ai/context.js";

/** How far back, by default, a change is considered a plausible cause. */
export const DEFAULT_WINDOW_HOURS = 72;

/**
 * Normalize two file paths and decide whether they refer to the same file.
 * Handles exact matches and path-suffix/basename matches (Sentry frames and git
 * paths don't always share the same root).
 */
export function sameFile(a: string, b: string): boolean {
  if (a === b) return true;
  const na = a.replace(/^\.?\//, "");
  const nb = b.replace(/^\.?\//, "");
  if (na === nb) return true;
  if (na.endsWith(`/${nb}`) || nb.endsWith(`/${na}`)) return true;
  return basename(na) === basename(nb) && basename(na).includes(".");
}

function basename(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}

/** The in-app files on the failing path, top frame first, de-duplicated. */
export function stackFiles(frames: StackFrame[]): string[] {
  const seen = new Set<string>();
  const files: string[] = [];
  for (const frame of frames) {
    if (frame.inApp === false || !frame.filename) continue;
    if (seen.has(frame.filename)) continue;
    seen.add(frame.filename);
    files.push(frame.filename);
  }
  return files;
}

function humanizeGap(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.round(hours / 24)} d`;
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

interface ScoreInput {
  files: string[];
  topFile: string | undefined;
  changeFiles: string[];
  occurredAt: Date | null;
  firstSeen: Date;
  windowMs: number;
}

/** Score a single change by file overlap with the stack trace + timing. */
function scoreChange({
  files,
  topFile,
  changeFiles,
  occurredAt,
  firstSeen,
  windowMs,
}: ScoreInput): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  const matches = files.filter((f) => changeFiles.some((cf) => sameFile(cf, f)));
  if (matches.length > 0) {
    score += Math.min(60, 25 * matches.length);
    reasons.push(
      `Modifies ${matches.length} file(s) on the stack trace (${matches.join(", ")})`,
    );
  }
  if (topFile && changeFiles.some((cf) => sameFile(cf, topFile))) {
    score += 15;
    reasons.push(`Touches the top stack frame file (${topFile})`);
  }

  if (occurredAt) {
    const gap = firstSeen.getTime() - occurredAt.getTime();
    if (gap >= 0 && gap <= windowMs) {
      score += Math.round(25 * (1 - gap / windowMs));
      reasons.push(`Landed ${humanizeGap(gap)} before the investigated occurrence`);
    }
  }

  return { score: clamp(score), reasons };
}

interface BuildCandidatesInput {
  frames: StackFrame[];
  pullRequests: PullRequest[];
  commits: Commit[];
  deployments: Deployment[];
  incidentFirstSeen: Date;
  incidentRelease: string | null;
  windowHours?: number;
}

/**
 * Pre-rank every recent change against the incident. The result is a hint for
 * the agent (and a deterministic fallback ranking if the model produces none).
 */
export function buildCandidates({
  frames,
  pullRequests,
  commits,
  deployments,
  incidentFirstSeen,
  incidentRelease,
  windowHours = DEFAULT_WINDOW_HOURS,
}: BuildCandidatesInput): CandidateChange[] {
  const files = stackFiles(frames);
  const topFile = files[0];
  const windowMs = windowHours * 60 * 60 * 1000;

  const candidates: CandidateChange[] = [];

  for (const pr of pullRequests) {
    const { score, reasons } = scoreChange({
      files,
      topFile,
      changeFiles: pr.filesChanged ?? [],
      occurredAt: pr.mergedAt,
      firstSeen: incidentFirstSeen,
      windowMs,
    });
    candidates.push({
      changeType: "pull_request",
      identifier: String(pr.number),
      label: `PR #${pr.number} — ${pr.title}`,
      filesChanged: pr.filesChanged ?? [],
      occurredAt: pr.mergedAt,
      score,
      reasons,
    });
  }

  for (const commit of commits) {
    const { score, reasons } = scoreChange({
      files,
      topFile,
      changeFiles: commit.filesChanged ?? [],
      occurredAt: commit.authoredAt,
      firstSeen: incidentFirstSeen,
      windowMs,
    });
    candidates.push({
      changeType: "commit",
      identifier: commit.sha,
      label: `Commit ${commit.sha.slice(0, 8)} — ${commit.message ?? ""}`.trim(),
      filesChanged: commit.filesChanged ?? [],
      occurredAt: commit.authoredAt,
      score,
      reasons,
    });
  }

  for (const deployment of deployments) {
    let score = 0;
    const reasons: string[] = [];
    if (deployment.deployedAt) {
      const gap = incidentFirstSeen.getTime() - deployment.deployedAt.getTime();
      if (gap >= 0 && gap <= windowMs) {
        score += Math.round(30 * (1 - gap / windowMs));
        reasons.push(`Deployed ${humanizeGap(gap)} before the investigated occurrence`);
      }
    }
    if (
      deployment.releaseVersion &&
      incidentRelease &&
      deployment.releaseVersion === incidentRelease
    ) {
      score += 45;
      reasons.push(
        `Shipped the release the incident first appeared on (${incidentRelease})`,
      );
    }
    candidates.push({
      changeType: "deployment",
      identifier: deployment.releaseVersion ?? deployment.id,
      label: `Deploy ${deployment.releaseVersion ?? ""} → ${deployment.environment ?? "production"}`.trim(),
      filesChanged: [],
      occurredAt: deployment.deployedAt,
      score: clamp(score),
      reasons,
    });
  }

  return candidates.sort((a, b) => b.score - a.score);
}

import { activityLog, db, type FixHandoff } from "@repo/db";
import { env } from "../lib/env.js";
import { AppError } from "../middleware/error-handler.js";
import { generateCodeFix } from "./code-fix.js";
import {
  createFixPullRequest,
  getConfiguredGithubFullName,
  getGithubFileContent,
  toRepoRelativePath,
  type FixFileChange,
} from "./github-sync.js";
import { getIncidentById, type IncidentDetailRow } from "./incidents.js";

type InvestigationRow = IncidentDetailRow["investigations"][number];

const MAX_FIX_FILES = 2;
const MAX_FIX_FILE_CHARS = 16_000;
const SOURCE_FILE_RE = /\.(tsx?|jsx?|mjs|cjs|py|go|rb|java|rs|php|cs|kt|swift)$/;

export interface FixPrResult {
  url: string | null;
  number: number | null;
  branch: string;
  draft: boolean;
  applied: boolean;
  alreadyExists: boolean;
}

interface FixChanges {
  changes: FixFileChange[];
  applied: boolean;
  summary: string | null;
}

/**
 * Turn a completed investigation into a real fix PR: resolve the suspect files,
 * have the model produce the actual code fix, commit it to a fresh branch, and
 * open a (draft) PR. Falls back to a plan-only PR when no confident code fix can
 * be generated. User-initiated and idempotent per incident.
 */
export async function openDraftFixPr(
  organizationId: string,
  incidentId: string,
): Promise<FixPrResult> {
  if (!env.GITHUB_TOKEN || !getConfiguredGithubFullName()) {
    throw new AppError(
      400,
      "GitHub is not configured. Set GITHUB_TOKEN, GITHUB_OWNER, and GITHUB_REPO.",
    );
  }

  const incident = await getIncidentById(organizationId, incidentId);
  if (!incident) throw new AppError(404, "Incident not found");

  const investigation = incident.investigations[0];
  if (!investigation || investigation.status !== "complete") {
    throw new AppError(
      409,
      "Run a completed investigation before opening a fix PR.",
    );
  }

  const existing = findExistingDraftPr(incident, investigation.id);
  if (existing) return existing;

  const branch = buildBranchName(incident.id);
  const fix = await buildFixChanges(incident, investigation);

  const changes: FixFileChange[] = fix.applied
    ? fix.changes
    : [
        {
          path: `.flare/${branch.replace(/\//g, "-")}.md`,
          content: buildPlanFile(incident, investigation),
        },
      ];

  const pr = await createFixPrOrThrow({
    branch,
    title: `${fix.applied ? "Flare fix" : "Flare fix plan"}: ${incident.title}`.slice(
      0,
      200,
    ),
    body: buildPrBody(incident, investigation, fix),
    changes,
    commitMessage: (fix.applied
      ? `flare: apply fix for ${incident.title}`
      : `flare: scaffold fix for ${incident.title}`
    ).slice(0, 100),
  });

  await db.insert(activityLog).values({
    incidentId: incident.id,
    type: "notified",
    message: `Opened ${pr.draft ? "draft " : ""}fix PR${pr.number ? ` #${pr.number}` : ""}${
      fix.applied ? " with an automated code fix" : " (fix plan)"
    }`,
    actor: "flare-agent",
    metadata: {
      channel: "github",
      kind: "draft_pr",
      ref: pr.number ? `#${pr.number}` : null,
      url: pr.url,
      number: pr.number,
      branch: pr.branch,
      draft: pr.draft,
      applied: fix.applied,
      investigationId: investigation.id,
    },
  });

  return {
    url: pr.url,
    number: pr.number,
    branch: pr.branch,
    draft: pr.draft,
    applied: fix.applied,
    alreadyExists: false,
  };
}

/**
 * Resolve the suspect file(s), ask the model for the actual fix, and keep only
 * confident, non-empty edits to files we actually fetched. Any failure degrades
 * to a plan-only PR rather than blocking the action.
 */
async function buildFixChanges(
  incident: IncidentDetailRow,
  investigation: InvestigationRow,
): Promise<FixChanges> {
  const none: FixChanges = { changes: [], applied: false, summary: null };

  try {
    const targets = resolveTargetFiles(incident, investigation);
    if (!targets.length) return none;

    const fetched = [];
    for (const path of targets) {
      const file = await getGithubFileContent({ path });
      if (
        file.found &&
        file.content != null &&
        file.sha &&
        file.content.length <= MAX_FIX_FILE_CHARS
      ) {
        fetched.push({ path: file.path, content: file.content, sha: file.sha });
      }
    }
    if (!fetched.length) return none;

    const result = await generateCodeFix({
      rootCause: investigation.rootCause,
      mechanism: investigation.analysis?.mechanism ?? null,
      failurePoint: investigation.analysis?.failurePoint ?? null,
      fixDetail:
        investigation.fixHandoff?.fixPlan.detail ??
        investigation.suggestedFixes?.[0]?.detail ??
        null,
      files: fetched.map((f) => ({ path: f.path, content: f.content })),
    });

    if (!result.confident || !result.changes.length) return none;

    const byPath = new Map(fetched.map((f) => [f.path, f]));
    const changes: FixFileChange[] = [];
    const seen = new Set<string>();
    for (const change of result.changes) {
      const source = byPath.get(change.path);
      if (!source) continue; // never edit a file we didn't fetch
      if (seen.has(source.path)) continue; // dedupe: a second PUT would use a stale sha
      if (change.newContent.trim() === source.content.trim()) continue; // no-op
      seen.add(source.path);
      changes.push({ path: source.path, content: change.newContent, sha: source.sha });
    }

    if (!changes.length) return none;
    return { changes, applied: true, summary: result.summary };
  } catch (err) {
    console.warn(
      "[fix-pr] code-fix generation failed; opening plan-only PR:",
      err instanceof Error ? err.message : err,
    );
    return none;
  }
}

function resolveTargetFiles(
  incident: IncidentDetailRow,
  investigation: InvestigationRow,
): string[] {
  const plan = normalizePaths(investigation.fixHandoff?.fixPlan.targetFiles ?? []);
  const stack = normalizePaths(
    (incident.events[0]?.stackTrace ?? [])
      .filter((frame) => frame.inApp !== false)
      .map((frame) => frame.filename),
  );
  const prFiles = normalizePaths(
    incident.suspects[0]?.pullRequest?.filesChanged ?? [],
  );

  // Highest signal first: files named in the plan, then files on both the stack
  // and the suspect PR, then either source alone.
  const overlap = stack.filter((path) => prFiles.includes(path));
  return unique([...plan, ...overlap, ...stack, ...prFiles])
    .filter((path) => SOURCE_FILE_RE.test(path))
    .slice(0, MAX_FIX_FILES);
}

function normalizePaths(paths: string[]): string[] {
  return paths
    .map((path) => toRepoRelativePath(path))
    .filter((path): path is string => Boolean(path));
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}

function findExistingDraftPr(
  incident: IncidentDetailRow,
  investigationId: string,
): FixPrResult | null {
  // Scope to the current investigation so re-investigating an incident opens a
  // fresh PR rather than returning the one from the previous investigation.
  const entry = incident.activity.find((row) => {
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
    branch: typeof meta["branch"] === "string" ? meta["branch"] : "",
    draft: meta["draft"] === true,
    applied: meta["applied"] === true,
    alreadyExists: true,
  };
}

/** Turn raw GitHub write failures into actionable, client-friendly errors. */
async function createFixPrOrThrow(
  input: Parameters<typeof createFixPullRequest>[0],
) {
  try {
    return await createFixPullRequest(input);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("(403)") || message.includes("(401)")) {
      throw new AppError(
        403,
        "GitHub rejected the write. The token needs Contents: write and Pull requests: write scope on this repo.",
      );
    }
    if (message.includes("(404)")) {
      throw new AppError(
        404,
        "GitHub repo or default branch not found for the configured token.",
      );
    }
    throw new AppError(502, `Could not open the fix PR: ${message.slice(0, 200)}`);
  }
}

function buildBranchName(incidentId: string): string {
  const short = incidentId.replace(/-/g, "").slice(0, 8);
  return `flare/fix-${short}-${Date.now().toString(36)}`;
}

function artifactBody(
  handoff: FixHandoff | null,
  kind: FixHandoff["artifacts"][number]["kind"],
): string | null {
  const body = handoff?.artifacts.find((a) => a.kind === kind)?.body;
  return body && body.trim() ? body : null;
}

function buildPrBody(
  incident: IncidentDetailRow,
  investigation: InvestigationRow,
  fix: FixChanges,
): string {
  const handoffBody =
    artifactBody(investigation.fixHandoff, "pr_description") ??
    derivedPlan(incident, investigation);

  if (fix.applied) {
    const summary = fix.summary ? `${fix.summary}\n\n` : "";
    return `## Automated fix by Flare\n${summary}${handoffBody}\n\n---\n_This fix was generated by Flare from incident “${incident.title}”. Review the diff before merging._`;
  }

  return `${handoffBody}\n\n---\n_Drafted by Flare from incident “${incident.title}”. The fix plan is committed in this branch — implement it here, then mark the PR ready for review._`;
}

function buildPlanFile(
  incident: IncidentDetailRow,
  investigation: InvestigationRow,
): string {
  return (
    artifactBody(investigation.fixHandoff, "agent_prompt") ??
    derivedPlan(incident, investigation)
  );
}

function derivedPlan(
  incident: IncidentDetailRow,
  investigation: InvestigationRow,
): string {
  const lines = [
    "# Flare fix plan",
    "",
    investigation.rootCause ??
      investigation.summary ??
      "Flare identified a likely production regression.",
  ];

  const fixes = investigation.suggestedFixes ?? [];
  if (fixes.length) {
    lines.push("", "## Suggested fixes");
    for (const fix of fixes.slice(0, 3)) {
      lines.push(`- ${fix.title} (${fix.action}): ${fix.detail}`);
    }
  }

  lines.push("", `Incident: ${incident.title}`);
  return lines.join("\n");
}

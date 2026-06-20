import { tool } from "ai";
import { z } from "zod";
import type { InvestigationContext } from "./context.js";
import { DEFAULT_WINDOW_HOURS, sameFile, stackFiles } from "../correlation.js";

const iso = (date: Date | null | undefined) => (date ? date.toISOString() : null);
const MAX_RECENT_CHANGES = 10;
const MAX_FILES_PER_CHANGE = 12;
const MAX_PR_DETAIL_FILES = 30;
const MAX_PR_BODY_CHARS = 1_200;
const MAX_COMMIT_MESSAGE_CHARS = 400;

function truncate(value: string | null | undefined, max: number): string | null {
  if (!value) return null;
  return value.length <= max ? value : `${value.slice(0, max - 3)}...`;
}

function summarizeFiles(
  files: string[] | null | undefined,
  traceFiles: string[],
  limit: number,
) {
  const allFiles = files ?? [];
  const matchingStackFiles = traceFiles.filter((traceFile) =>
    allFiles.some((file) => sameFile(file, traceFile)),
  );
  const relevantFirst = [
    ...allFiles.filter((file) =>
      matchingStackFiles.some((traceFile) => sameFile(file, traceFile)),
    ),
    ...allFiles.filter(
      (file) =>
        !matchingStackFiles.some((traceFile) => sameFile(file, traceFile)),
    ),
  ];

  return {
    filesChanged: relevantFirst.slice(0, limit),
    filesChangedCount: allFiles.length,
    filesChangedTruncated: allFiles.length > limit,
    matchingStackFiles,
  };
}

/**
 * The agent's toolset, bound to a single incident's context. Each tool reads
 * from the in-memory snapshot loaded in `loadInvestigationContext`, so calls are
 * fast and deterministic. These mirror the real Sentry/GitHub integrations that
 * will back them later — same shapes, swappable implementation.
 */
export function buildInvestigationTools(ctx: InvestigationContext) {
  const traceFiles = stackFiles(ctx.stackFrames);
  const withinWindow = (occurredAt: Date | null, windowMs: number) => {
    if (!occurredAt) return false;
    const gap = ctx.analysisTime.getTime() - occurredAt.getTime();
    return gap >= 0 && gap <= windowMs;
  };

  return {
    get_stack_trace: tool({
      description:
        "Return the stack trace for this incident — the files, functions, and line numbers on the failing path, top frame first.",
      inputSchema: z.object({}),
      execute: async () => ({
        frames: ctx.stackFrames.map((f) => ({
          filename: f.filename,
          function: f.function ?? null,
          lineno: f.lineno ?? null,
          inApp: f.inApp !== false,
        })),
      }),
    }),

    list_recent_changes: tool({
      description:
        "List merged pull requests, commits, and deployments to the connected repositories that landed before the incident, within a time window.",
      inputSchema: z.object({
        withinHours: z
          .number()
          .int()
          .positive()
          .max(720)
          .optional()
          .describe(`Look-back window in hours (default ${DEFAULT_WINDOW_HOURS}).`),
      }),
      execute: async ({ withinHours }) => {
        const windowMs = (withinHours ?? DEFAULT_WINDOW_HOURS) * 60 * 60 * 1000;
        return {
          pullRequests: ctx.pullRequests
            .filter((pr) => withinWindow(pr.mergedAt, windowMs))
            .slice(0, MAX_RECENT_CHANGES)
            .map((pr) => ({
              number: pr.number,
              title: pr.title,
              author: pr.author,
              ...summarizeFiles(
                pr.filesChanged,
                traceFiles,
                MAX_FILES_PER_CHANGE,
              ),
              mergedAt: iso(pr.mergedAt),
            })),
          commits: ctx.commits
            .filter((c) => withinWindow(c.authoredAt, windowMs))
            .slice(0, MAX_RECENT_CHANGES)
            .map((c) => ({
              sha: c.sha,
              message: truncate(c.message, MAX_COMMIT_MESSAGE_CHARS),
              author: c.author,
              ...summarizeFiles(
                c.filesChanged,
                traceFiles,
                MAX_FILES_PER_CHANGE,
              ),
              authoredAt: iso(c.authoredAt),
            })),
          deployments: ctx.deployments
            .filter((d) => withinWindow(d.deployedAt, windowMs))
            .slice(0, MAX_RECENT_CHANGES)
            .map((d) => ({
              releaseVersion: d.releaseVersion,
              environment: d.environment,
              commitSha: d.commitSha,
              deployedAt: iso(d.deployedAt),
            })),
        };
      },
    }),

    get_pull_request: tool({
      description:
        "Get bounded details for one pull request by number: description, relevant changed files, author, and size.",
      inputSchema: z.object({
        number: z.number().int().describe("The pull request number."),
      }),
      execute: async ({ number }) => {
        const pr = ctx.pullRequests.find((p) => p.number === number);
        if (!pr) return { found: false as const, number };
        return {
          found: true as const,
          number: pr.number,
          title: pr.title,
          body: truncate(pr.body, MAX_PR_BODY_CHARS),
          bodyTruncated: Boolean(pr.body && pr.body.length > MAX_PR_BODY_CHARS),
          author: pr.author,
          branch: pr.branch,
          baseBranch: pr.baseBranch,
          ...summarizeFiles(pr.filesChanged, traceFiles, MAX_PR_DETAIL_FILES),
          additions: pr.additions,
          deletions: pr.deletions,
          url: pr.url,
          mergedAt: iso(pr.mergedAt),
        };
      },
    }),

    get_file_blame: tool({
      description:
        "Find the most recent change (pull request or commit) that touched a given file. Use this to see who last modified a file on the stack trace.",
      inputSchema: z.object({
        filename: z.string().describe("Path of the file, e.g. 'src/db/pool.ts'."),
      }),
      execute: async ({ filename }) => {
        const touchingPrs = ctx.pullRequests
          .filter((pr) => (pr.filesChanged ?? []).some((f) => sameFile(f, filename)))
          .map((pr) => ({
            type: "pull_request" as const,
            identifier: String(pr.number),
            label: `PR #${pr.number} — ${pr.title}`,
            author: pr.author,
            at: pr.mergedAt,
          }));
        const touchingCommits = ctx.commits
          .filter((c) => (c.filesChanged ?? []).some((f) => sameFile(f, filename)))
          .map((c) => ({
            type: "commit" as const,
            identifier: c.sha,
            label: `Commit ${c.sha.slice(0, 8)} — ${c.message ?? ""}`.trim(),
            author: c.author,
            at: c.authoredAt,
          }));

        const all = [...touchingPrs, ...touchingCommits].sort(
          (a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0),
        );
        const latest = all[0];
        if (!latest) return { found: false as const, filename };
        return {
          found: true as const,
          filename,
          lastChangedBy: {
            type: latest.type,
            identifier: latest.identifier,
            label: latest.label,
            author: latest.author,
            at: iso(latest.at),
          },
        };
      },
    }),

    find_similar_incidents: tool({
      description:
        "Find prior resolved incidents that resemble this one (same fingerprint or error type) and how they were resolved.",
      inputSchema: z.object({}),
      execute: async () => ({
        incidents: ctx.similarIncidents.map((s) => ({
          title: s.title,
          errorType: s.errorType,
          resolution: s.resolution,
          resolvedAt: iso(s.resolvedAt),
        })),
      }),
    }),
  };
}

export type InvestigationTools = ReturnType<typeof buildInvestigationTools>;

import { tool } from "ai";
import { z } from "zod";
import type { InvestigationContext } from "./context.js";
import { DEFAULT_WINDOW_HOURS, sameFile, stackFiles } from "../correlation.js";
import {
  getGithubFileSourceWindow,
  getGithubPullRequestFilePatch,
} from "../../services/github-sync.js";

const iso = (date: Date | null | undefined) => (date ? date.toISOString() : null);
const MAX_RECENT_CHANGES = 10;
const MAX_FILES_PER_CHANGE = 12;
const MAX_PR_DETAIL_FILES = 30;
const MAX_PR_BODY_CHARS = 1_200;
const MAX_COMMIT_MESSAGE_CHARS = 400;
const MAX_SOURCE_TOOL_CALLS = 3;
const MAX_PATCH_TOOL_CALLS = 2;
const MAX_TOTAL_CODE_CONTEXT_CHARS = 40_000;

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
  let sourceToolCalls = 0;
  let patchToolCalls = 0;
  let totalCodeContextChars = 0;
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

    get_stack_frame_source: tool({
      description:
        "Fetch a bounded source-code window from GitHub around a stack-frame file and line. Use this for the top in-app stack frame or another stack file before making code-level claims.",
      inputSchema: z.object({
        filename: z
          .string()
          .describe("Path from the stack trace, e.g. 'src/services/refunds.ts'."),
        line: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Line number to center the source window around."),
        radius: z
          .number()
          .int()
          .positive()
          .max(80)
          .optional()
          .describe("Number of lines to include before and after the target line."),
      }),
      execute: async ({ filename, line, radius }) => {
        if (sourceToolCalls >= MAX_SOURCE_TOOL_CALLS) {
          return {
            found: false as const,
            filename,
            reason: `Source context budget exhausted (${MAX_SOURCE_TOOL_CALLS} files max).`,
          };
        }
        if (totalCodeContextChars >= MAX_TOTAL_CODE_CONTEXT_CHARS) {
          return {
            found: false as const,
            filename,
            reason: `Total code context budget exhausted (${MAX_TOTAL_CODE_CONTEXT_CHARS} chars max).`,
          };
        }

        sourceToolCalls += 1;
        const result = await getGithubFileSourceWindow({ filename, line, radius });
        const contentLength = result.content?.length ?? 0;
        totalCodeContextChars += contentLength;

        if (totalCodeContextChars > MAX_TOTAL_CODE_CONTEXT_CHARS && result.content) {
          const allowed = Math.max(
            0,
            contentLength - (totalCodeContextChars - MAX_TOTAL_CODE_CONTEXT_CHARS),
          );
          return {
            ...result,
            content: `${result.content.slice(0, allowed)}\n... [truncated by Flare total code-context budget]`,
            truncated: true,
          };
        }

        return result;
      },
    }),

    get_pr_file_patch: tool({
      description:
        "Fetch the bounded GitHub patch for one file in one pull request. Use this for a suspect PR that touched a stack-frame file.",
      inputSchema: z.object({
        number: z.number().int().describe("The pull request number."),
        filename: z
          .string()
          .describe("The stack-frame or repo-relative filename to inspect."),
      }),
      execute: async ({ number, filename }) => {
        if (patchToolCalls >= MAX_PATCH_TOOL_CALLS) {
          return {
            found: false as const,
            number,
            filename,
            reason: `Patch context budget exhausted (${MAX_PATCH_TOOL_CALLS} files max).`,
          };
        }
        if (totalCodeContextChars >= MAX_TOTAL_CODE_CONTEXT_CHARS) {
          return {
            found: false as const,
            number,
            filename,
            reason: `Total code context budget exhausted (${MAX_TOTAL_CODE_CONTEXT_CHARS} chars max).`,
          };
        }

        patchToolCalls += 1;
        const result = await getGithubPullRequestFilePatch({ number, filename });
        const patchLength = result.patch?.length ?? 0;
        totalCodeContextChars += patchLength;

        if (totalCodeContextChars > MAX_TOTAL_CODE_CONTEXT_CHARS && result.patch) {
          const allowed = Math.max(
            0,
            patchLength - (totalCodeContextChars - MAX_TOTAL_CODE_CONTEXT_CHARS),
          );
          return {
            ...result,
            patch: `${result.patch.slice(0, allowed)}\n... [truncated by Flare total code-context budget]`,
            truncated: true,
          };
        }

        return result;
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

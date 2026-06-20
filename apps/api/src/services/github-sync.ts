import { and, eq } from "drizzle-orm";
import {
  commits,
  db,
  integrations,
  pullRequests,
  repositories,
  type Commit,
  type Integration,
  type PullRequest,
  type Repository,
} from "@repo/db";
import { env } from "../lib/env.js";
import { sameFile } from "../lib/correlation.js";

const GITHUB_API_URL = "https://api.github.com";
const DEFAULT_SYNC_LIMIT = 30;
const DEFAULT_SOURCE_RADIUS = 60;
const MAX_SOURCE_RADIUS = 80;
const MAX_SOURCE_CHARS = 20_000;
const MAX_PATCH_CHARS = 20_000;

interface GithubSyncOptions {
  commitLimit?: number;
  pullRequestLimit?: number;
}

export interface GithubSyncResult {
  repository: {
    id: string;
    fullName: string;
    defaultBranch: string;
    htmlUrl: string | null;
  };
  commits: {
    fetched: number;
    upserted: number;
  };
  pullRequests: {
    fetched: number;
    merged: number;
    upserted: number;
  };
}

export interface GithubSyncStatus {
  configured: boolean;
  fullName: string | null;
  repository: {
    id: string;
    defaultBranch: string;
    githubId: string | null;
    lastSyncedAt: string | null;
  } | null;
  commits: number;
  pullRequests: number;
}

interface GithubRepoResponse {
  id: number;
  name: string;
  full_name: string;
  default_branch: string;
  html_url?: string;
}

interface GithubCommitListItem {
  sha: string;
  html_url?: string;
  author?: {
    login?: string;
  } | null;
  commit: {
    message?: string;
    author?: {
      name?: string;
      date?: string;
    } | null;
  };
}

interface GithubCommitResponse extends GithubCommitListItem {
  files?: Array<{
    filename?: string;
  }>;
}

interface GithubPullRequestListItem {
  number: number;
  title?: string;
  body?: string | null;
  html_url?: string;
  merged_at?: string | null;
  merge_commit_sha?: string | null;
  user?: {
    login?: string;
  } | null;
  head?: {
    ref?: string;
  };
  base?: {
    ref?: string;
  };
}

interface GithubPullRequestResponse extends GithubPullRequestListItem {
  additions?: number;
  deletions?: number;
}

interface GithubPullRequestFile {
  filename?: string;
  previous_filename?: string;
  status?: string;
  additions?: number;
  deletions?: number;
  changes?: number;
  patch?: string;
  blob_url?: string;
  raw_url?: string;
}

interface GithubContentFileResponse {
  type: string;
  path: string;
  sha?: string;
  size?: number;
  encoding?: string;
  content?: string;
  html_url?: string;
  download_url?: string | null;
}

export interface GithubFileSourceResult {
  found: boolean;
  filename: string;
  path: string | null;
  ref: string;
  startLine?: number;
  endLine?: number;
  totalLines?: number;
  sizeBytes?: number;
  content?: string;
  url?: string | null;
  truncated?: boolean;
  reason?: string;
}

export interface GithubPullRequestPatchResult {
  found: boolean;
  number: number;
  filename: string;
  path: string | null;
  status?: string | null;
  additions?: number | null;
  deletions?: number | null;
  changes?: number | null;
  patch?: string | null;
  url?: string | null;
  truncated?: boolean;
  reason?: string;
}

class GithubSyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GithubSyncError";
  }
}

function configuredRepoFullName(): string | null {
  if (!env.GITHUB_OWNER || !env.GITHUB_REPO) return null;
  return `${env.GITHUB_OWNER}/${env.GITHUB_REPO}`;
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function truncateCode(value: string, max: number): {
  value: string;
  truncated: boolean;
} {
  if (value.length <= max) return { value, truncated: false };
  return {
    value: `${value.slice(0, max - 80)}\n... [truncated by Flare code-context budget]`,
    truncated: true,
  };
}

function withLineNumbers(lines: string[], startLine: number): string {
  return lines
    .map((line, index) => `${String(startLine + index).padStart(4, " ")} | ${line}`)
    .join("\n");
}

export function toRepoRelativePath(filename: string): string | null {
  const repoName = env.GITHUB_REPO;
  const cleaned = filename
    .replace(/^file:\/\//, "")
    .replace(/\\/g, "/")
    .split(/[?#]/)[0]
    ?.trim();

  if (!cleaned || cleaned.includes("/node_modules/")) return null;
  const relative = cleaned.replace(/^\.\//, "");
  if (!relative.startsWith("/")) {
    return repoName && relative.startsWith(`${repoName}/`)
      ? relative.slice(repoName.length + 1)
      : relative;
  }

  if (!repoName) return null;

  const parts = relative.split("/").filter(Boolean);
  const repoIndex = parts.lastIndexOf(repoName);
  if (repoIndex >= 0 && repoIndex < parts.length - 1) {
    return parts.slice(repoIndex + 1).join("/");
  }

  return null;
}

function requireGithubConfig() {
  const fullName = configuredRepoFullName();
  if (!env.GITHUB_TOKEN || !env.GITHUB_OWNER || !env.GITHUB_REPO || !fullName) {
    throw new GithubSyncError(
      "GitHub sync is not configured. Set GITHUB_TOKEN, GITHUB_OWNER, and GITHUB_REPO.",
    );
  }

  return {
    token: env.GITHUB_TOKEN,
    owner: env.GITHUB_OWNER,
    repo: env.GITHUB_REPO,
    fullName,
    defaultBranch: env.GITHUB_DEFAULT_BRANCH,
  };
}

function githubHeaders(token: string): Record<string, string> {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "user-agent": "flare-mvp-github-sync",
    "x-github-api-version": "2022-11-28",
  };
}

/** POST to the GitHub API (issue comments, new issues). */
async function githubWrite<T>(
  token: string,
  path: string,
  body: unknown,
): Promise<T> {
  const response = await fetch(`${GITHUB_API_URL}${path}`, {
    method: "POST",
    headers: { ...githubHeaders(token), "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new GithubSyncError(
      `GitHub POST failed (${response.status}) for ${path}: ${detail.slice(0, 240)}`,
    );
  }

  return (await response.json()) as T;
}

/** PUT to the GitHub API (create/update file contents on a branch). */
async function githubPut<T>(
  token: string,
  path: string,
  body: unknown,
): Promise<T> {
  const response = await fetch(`${GITHUB_API_URL}${path}`, {
    method: "PUT",
    headers: { ...githubHeaders(token), "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new GithubSyncError(
      `GitHub PUT failed (${response.status}) for ${path}: ${detail.slice(0, 240)}`,
    );
  }

  return (await response.json()) as T;
}

/** DELETE on the GitHub API (e.g. removing a branch ref). 404 is treated as ok. */
async function githubDelete(token: string, path: string): Promise<void> {
  const response = await fetch(`${GITHUB_API_URL}${path}`, {
    method: "DELETE",
    headers: githubHeaders(token),
  });

  if (!response.ok && response.status !== 404) {
    const detail = await response.text().catch(() => "");
    throw new GithubSyncError(
      `GitHub DELETE failed (${response.status}) for ${path}: ${detail.slice(0, 240)}`,
    );
  }
}

async function githubRequest<T>(
  token: string,
  path: string,
  params?: Record<string, string | number | undefined>,
): Promise<T> {
  const url = new URL(`${GITHUB_API_URL}${path}`);
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, { headers: githubHeaders(token) });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new GithubSyncError(
      `GitHub request failed (${response.status}) for ${url.pathname}: ${detail.slice(0, 240)}`,
    );
  }

  return (await response.json()) as T;
}

async function githubRequestOrNull<T>(
  token: string,
  path: string,
  params?: Record<string, string | number | undefined>,
): Promise<T | null> {
  try {
    return await githubRequest<T>(token, path, params);
  } catch (error) {
    if (error instanceof GithubSyncError && error.message.includes("(404)")) {
      return null;
    }
    throw error;
  }
}

async function ensureIntegration(
  organizationId: string,
  owner: string,
  repo: string,
  fullName: string,
): Promise<Integration> {
  const existingRows = await db.query.integrations.findMany({
    where: and(
      eq(integrations.organizationId, organizationId),
      eq(integrations.provider, "github"),
      eq(integrations.kind, "context"),
      eq(integrations.externalAccountId, owner),
    ),
  });

  const existing = existingRows.find((row) => {
    const config = row.config ?? {};
    return config["repo"] === repo || config["fullName"] === fullName;
  });

  const config = {
    source: "env",
    owner,
    repo,
    fullName,
    lastSyncedAt: new Date().toISOString(),
  };

  if (existing) {
    const [updated] = await db
      .update(integrations)
      .set({
        status: "connected",
        config,
        credentials: { source: "env" },
      })
      .where(eq(integrations.id, existing.id))
      .returning();

    if (!updated) throw new Error("Failed to update GitHub integration");
    return updated;
  }

  const [created] = await db
    .insert(integrations)
    .values({
      organizationId,
      provider: "github",
      kind: "context",
      status: "connected",
      externalAccountId: owner,
      config,
      credentials: { source: "env" },
    })
    .returning();

  if (!created) throw new Error("Failed to create GitHub integration");
  return created;
}

async function upsertRepository(
  integrationId: string,
  owner: string,
  name: string,
  repo: GithubRepoResponse,
): Promise<Repository> {
  const existing = await db.query.repositories.findFirst({
    where: and(
      eq(repositories.integrationId, integrationId),
      eq(repositories.fullName, repo.full_name),
    ),
  });

  const values = {
    integrationId,
    owner,
    name,
    fullName: repo.full_name,
    defaultBranch: repo.default_branch,
    githubId: String(repo.id),
  };

  if (existing) {
    const [updated] = await db
      .update(repositories)
      .set(values)
      .where(eq(repositories.id, existing.id))
      .returning();

    if (!updated) throw new Error("Failed to update repository");
    return updated;
  }

  const [created] = await db.insert(repositories).values(values).returning();
  if (!created) throw new Error("Failed to create repository");
  return created;
}

async function upsertCommit(
  repositoryId: string,
  input: Omit<typeof commits.$inferInsert, "repositoryId">,
): Promise<Commit> {
  const existing = await db.query.commits.findFirst({
    where: and(eq(commits.repositoryId, repositoryId), eq(commits.sha, input.sha)),
  });

  const values = { ...input, repositoryId };
  if (existing) {
    const [updated] = await db
      .update(commits)
      .set(values)
      .where(eq(commits.id, existing.id))
      .returning();

    if (!updated) throw new Error(`Failed to update commit ${input.sha}`);
    return updated;
  }

  const [created] = await db.insert(commits).values(values).returning();
  if (!created) throw new Error(`Failed to create commit ${input.sha}`);
  return created;
}

async function upsertPullRequest(
  repositoryId: string,
  input: Omit<typeof pullRequests.$inferInsert, "repositoryId">,
): Promise<PullRequest> {
  const existing = await db.query.pullRequests.findFirst({
    where: and(
      eq(pullRequests.repositoryId, repositoryId),
      eq(pullRequests.number, input.number),
    ),
  });

  const values = { ...input, repositoryId };
  if (existing) {
    const [updated] = await db
      .update(pullRequests)
      .set(values)
      .where(eq(pullRequests.id, existing.id))
      .returning();

    if (!updated) throw new Error(`Failed to update PR #${input.number}`);
    return updated;
  }

  const [created] = await db.insert(pullRequests).values(values).returning();
  if (!created) throw new Error(`Failed to create PR #${input.number}`);
  return created;
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function commitAuthor(commit: GithubCommitResponse): string | null {
  return commit.author?.login ?? commit.commit.author?.name ?? null;
}

function fileNames(files: Array<{ filename?: string }> | undefined): string[] {
  return (files ?? [])
    .map((file) => file.filename)
    .filter((file): file is string => Boolean(file));
}

export async function syncConfiguredGithubRepo(
  organizationId: string,
  options: GithubSyncOptions = {},
): Promise<GithubSyncResult | null> {
  if (!env.GITHUB_TOKEN || !env.GITHUB_OWNER || !env.GITHUB_REPO) {
    return null;
  }

  return syncGithubRepo(organizationId, options);
}

export async function syncGithubRepo(
  organizationId: string,
  options: GithubSyncOptions = {},
): Promise<GithubSyncResult> {
  const config = requireGithubConfig();
  const commitLimit = options.commitLimit ?? DEFAULT_SYNC_LIMIT;
  const pullRequestLimit = options.pullRequestLimit ?? DEFAULT_SYNC_LIMIT;

  const repo = await githubRequest<GithubRepoResponse>(
    config.token,
    `/repos/${config.owner}/${config.repo}`,
  );

  const integration = await ensureIntegration(
    organizationId,
    config.owner,
    config.repo,
    repo.full_name,
  );
  const repository = await upsertRepository(
    integration.id,
    config.owner,
    config.repo,
    repo,
  );

  const commitList = await githubRequest<GithubCommitListItem[]>(
    config.token,
    `/repos/${config.owner}/${config.repo}/commits`,
    {
      sha: repo.default_branch ?? config.defaultBranch,
      per_page: commitLimit,
    },
  );

  let upsertedCommits = 0;
  for (const item of commitList) {
    const detail = await githubRequest<GithubCommitResponse>(
      config.token,
      `/repos/${config.owner}/${config.repo}/commits/${item.sha}`,
    );

    await upsertCommit(repository.id, {
      sha: detail.sha,
      message: detail.commit.message ?? null,
      author: commitAuthor(detail),
      filesChanged: fileNames(detail.files),
      url: detail.html_url ?? null,
      authoredAt: parseDate(detail.commit.author?.date),
    });
    upsertedCommits += 1;
  }

  const prList = await githubRequest<GithubPullRequestListItem[]>(
    config.token,
    `/repos/${config.owner}/${config.repo}/pulls`,
    {
      state: "closed",
      base: repo.default_branch ?? config.defaultBranch,
      sort: "updated",
      direction: "desc",
      per_page: pullRequestLimit,
    },
  );

  const mergedPullRequests = prList.filter((pr) => Boolean(pr.merged_at));
  let upsertedPullRequests = 0;
  for (const pr of mergedPullRequests) {
    const [detail, files] = await Promise.all([
      githubRequest<GithubPullRequestResponse>(
        config.token,
        `/repos/${config.owner}/${config.repo}/pulls/${pr.number}`,
      ),
      githubRequest<GithubPullRequestFile[]>(
        config.token,
        `/repos/${config.owner}/${config.repo}/pulls/${pr.number}/files`,
        { per_page: 100 },
      ),
    ]);

    await upsertPullRequest(repository.id, {
      number: detail.number,
      title: detail.title ?? `Pull request #${detail.number}`,
      body: detail.body ?? null,
      author: detail.user?.login ?? null,
      branch: detail.head?.ref ?? null,
      baseBranch: detail.base?.ref ?? null,
      mergeCommitSha: detail.merge_commit_sha ?? null,
      filesChanged: fileNames(files),
      additions: detail.additions ?? null,
      deletions: detail.deletions ?? null,
      url: detail.html_url ?? null,
      mergedAt: parseDate(detail.merged_at),
    });
    upsertedPullRequests += 1;
  }

  return {
    repository: {
      id: repository.id,
      fullName: repository.fullName,
      defaultBranch: repository.defaultBranch,
      htmlUrl: repo.html_url ?? null,
    },
    commits: {
      fetched: commitList.length,
      upserted: upsertedCommits,
    },
    pullRequests: {
      fetched: prList.length,
      merged: mergedPullRequests.length,
      upserted: upsertedPullRequests,
    },
  };
}

export function getConfiguredGithubFullName(): string | null {
  return configuredRepoFullName();
}

export async function getGithubFileSourceWindow(input: {
  filename: string;
  line?: number;
  radius?: number;
  ref?: string;
}): Promise<GithubFileSourceResult> {
  const config = requireGithubConfig();
  const path = toRepoRelativePath(input.filename);
  const ref = input.ref ?? config.defaultBranch;

  if (!path) {
    return {
      found: false,
      filename: input.filename,
      path: null,
      ref,
      reason: "File path is not inside the configured GitHub repository.",
    };
  }

  const file = await githubRequestOrNull<GithubContentFileResponse>(
    config.token,
    `/repos/${config.owner}/${config.repo}/contents/${encodePath(path)}`,
    { ref },
  );

  if (!file || file.type !== "file" || !file.content) {
    return {
      found: false,
      filename: input.filename,
      path,
      ref,
      reason: "File was not found at the requested ref.",
    };
  }

  if (file.encoding && file.encoding !== "base64") {
    return {
      found: false,
      filename: input.filename,
      path,
      ref,
      reason: `Unsupported GitHub content encoding: ${file.encoding}.`,
    };
  }

  const decoded = Buffer.from(file.content.replace(/\n/g, ""), "base64").toString(
    "utf8",
  );
  const lines = decoded.split(/\r?\n/);
  const radius = clamp(input.radius ?? DEFAULT_SOURCE_RADIUS, 5, MAX_SOURCE_RADIUS);
  const centerLine = input.line
    ? clamp(input.line, 1, Math.max(1, lines.length))
    : Math.min(radius, Math.max(1, lines.length));
  const startLine = Math.max(1, centerLine - radius);
  const endLine = Math.min(lines.length, centerLine + radius);
  const numbered = withLineNumbers(lines.slice(startLine - 1, endLine), startLine);
  const truncated = truncateCode(numbered, MAX_SOURCE_CHARS);

  return {
    found: true,
    filename: input.filename,
    path,
    ref,
    startLine,
    endLine,
    totalLines: lines.length,
    sizeBytes: file.size,
    content: truncated.value,
    url: file.html_url ?? file.download_url ?? null,
    truncated: truncated.truncated,
  };
}

export async function getGithubPullRequestFilePatch(input: {
  number: number;
  filename: string;
}): Promise<GithubPullRequestPatchResult> {
  const config = requireGithubConfig();
  const path = toRepoRelativePath(input.filename);

  if (!path) {
    return {
      found: false,
      number: input.number,
      filename: input.filename,
      path: null,
      reason: "File path is not inside the configured GitHub repository.",
    };
  }

  const files = await githubRequest<GithubPullRequestFile[]>(
    config.token,
    `/repos/${config.owner}/${config.repo}/pulls/${input.number}/files`,
    { per_page: 100 },
  );

  const file = files.find(
    (candidate) =>
      (candidate.filename && sameFile(candidate.filename, path)) ||
      (candidate.previous_filename && sameFile(candidate.previous_filename, path)),
  );

  if (!file) {
    return {
      found: false,
      number: input.number,
      filename: input.filename,
      path,
      reason: "PR did not include this file in the first 100 changed files.",
    };
  }

  const patch = file.patch ?? null;
  const truncated = patch ? truncateCode(patch, MAX_PATCH_CHARS) : null;

  return {
    found: true,
    number: input.number,
    filename: input.filename,
    path: file.filename ?? path,
    status: file.status ?? null,
    additions: file.additions ?? null,
    deletions: file.deletions ?? null,
    changes: file.changes ?? null,
    patch: truncated?.value ?? null,
    url: file.blob_url ?? file.raw_url ?? null,
    truncated: truncated?.truncated ?? false,
    reason: patch ? undefined : "GitHub did not return a text patch for this file.",
  };
}

/**
 * Post a comment on a pull request (or issue) by number. Works on merged/closed
 * PRs — GitHub treats a PR as an issue for the comments endpoint, so no reopen.
 */
export async function postGithubIssueComment(input: {
  issueNumber: number;
  body: string;
}): Promise<{ url: string | null }> {
  const config = requireGithubConfig();
  const res = await githubWrite<{ html_url?: string }>(
    config.token,
    `/repos/${config.owner}/${config.repo}/issues/${input.issueNumber}/comments`,
    { body: input.body },
  );
  return { url: res.html_url ?? null };
}

/** Open a new issue in the configured repo. */
export async function createGithubIssue(input: {
  title: string;
  body: string;
}): Promise<{ url: string | null; number: number | null }> {
  const config = requireGithubConfig();
  const res = await githubWrite<{ html_url?: string; number?: number }>(
    config.token,
    `/repos/${config.owner}/${config.repo}/issues`,
    { title: input.title, body: input.body },
  );
  return { url: res.html_url ?? null, number: res.number ?? null };
}

interface GithubRefResponse {
  object: { sha: string };
}

export interface GithubFileContent {
  found: boolean;
  path: string;
  content: string | null;
  sha: string | null;
  url: string | null;
}

/** Fetch the full, decoded contents of a file (plus its blob sha for updates). */
export async function getGithubFileContent(input: {
  path: string;
  ref?: string;
}): Promise<GithubFileContent> {
  const config = requireGithubConfig();
  const path = toRepoRelativePath(input.path);
  const ref = input.ref ?? config.defaultBranch;

  if (!path) {
    return { found: false, path: input.path, content: null, sha: null, url: null };
  }

  const file = await githubRequestOrNull<GithubContentFileResponse>(
    config.token,
    `/repos/${config.owner}/${config.repo}/contents/${encodePath(path)}`,
    { ref },
  );

  if (
    !file ||
    file.type !== "file" ||
    !file.content ||
    (file.encoding && file.encoding !== "base64")
  ) {
    return { found: false, path, content: null, sha: null, url: file?.html_url ?? null };
  }

  const content = Buffer.from(file.content.replace(/\n/g, ""), "base64").toString(
    "utf8",
  );
  return {
    found: true,
    path,
    content,
    sha: file.sha ?? null,
    url: file.html_url ?? null,
  };
}

export interface DraftFixPullRequest {
  url: string | null;
  number: number | null;
  branch: string;
  draft: boolean;
}

export interface FixFileChange {
  path: string;
  content: string;
  /** Blob sha of the file being replaced; omit for new files. */
  sha?: string | null;
}

/**
 * Open a fix PR: branch off the default branch, commit the given file changes
 * (the actual code fix and/or a fix-plan file) so the branch has a diff, then
 * open the PR with the Flare handoff as its body. Tries a draft PR first and
 * falls back to a normal PR for repos/plans that don't support drafts.
 */
export async function createFixPullRequest(input: {
  branch: string;
  title: string;
  body: string;
  changes: FixFileChange[];
  commitMessage: string;
}): Promise<DraftFixPullRequest> {
  const config = requireGithubConfig();
  const base = config.defaultBranch;

  const ref = await githubRequest<GithubRefResponse>(
    config.token,
    `/repos/${config.owner}/${config.repo}/git/ref/heads/${encodeURIComponent(base)}`,
  );

  await githubWrite(config.token, `/repos/${config.owner}/${config.repo}/git/refs`, {
    ref: `refs/heads/${input.branch}`,
    sha: ref.object.sha,
  });

  // From here the branch exists; if committing or opening the PR fails, delete
  // the branch so a partial failure doesn't leave an orphaned ref behind.
  try {
    for (const change of input.changes) {
      await githubPut(
        config.token,
        `/repos/${config.owner}/${config.repo}/contents/${encodePath(change.path)}`,
        {
          message: input.commitMessage,
          content: Buffer.from(change.content, "utf8").toString("base64"),
          branch: input.branch,
          ...(change.sha ? { sha: change.sha } : {}),
        },
      );
    }

    return await openPullRequestWithDraftFallback(config, base, input);
  } catch (error) {
    await githubDelete(
      config.token,
      `/repos/${config.owner}/${config.repo}/git/refs/heads/${encodePath(input.branch)}`,
    ).catch(() => {});
    throw error;
  }
}

async function openPullRequestWithDraftFallback(
  config: { token: string; owner: string; repo: string },
  base: string,
  input: { branch: string; title: string; body: string },
): Promise<DraftFixPullRequest> {
  const prInput = { title: input.title, head: input.branch, base, body: input.body };
  const prPath = `/repos/${config.owner}/${config.repo}/pulls`;

  try {
    const pr = await githubWrite<{ html_url?: string; number?: number }>(
      config.token,
      prPath,
      { ...prInput, draft: true },
    );
    return { url: pr.html_url ?? null, number: pr.number ?? null, branch: input.branch, draft: true };
  } catch (error) {
    if (!(error instanceof GithubSyncError) || !error.message.includes("(422)")) {
      throw error;
    }
    // Drafts unsupported on this repo/plan — open a normal PR instead.
    const pr = await githubWrite<{ html_url?: string; number?: number }>(
      config.token,
      prPath,
      { ...prInput, draft: false },
    );
    return { url: pr.html_url ?? null, number: pr.number ?? null, branch: input.branch, draft: false };
  }
}

export async function getGithubSyncStatus(
  organizationId: string,
): Promise<GithubSyncStatus> {
  const fullName = configuredRepoFullName();
  if (!fullName) {
    return {
      configured: false,
      fullName: null,
      repository: null,
      commits: 0,
      pullRequests: 0,
    };
  }

  const integrationRows = await db.query.integrations.findMany({
    where: and(
      eq(integrations.organizationId, organizationId),
      eq(integrations.provider, "github"),
      eq(integrations.kind, "context"),
    ),
    with: { repositories: true },
  });

  const repository = integrationRows
    .flatMap((row) =>
      row.repositories.map((repo) => ({
        repo,
        integration: row,
      })),
    )
    .find(({ repo }) => repo.fullName === fullName);

  if (!repository) {
    return {
      configured: true,
      fullName,
      repository: null,
      commits: 0,
      pullRequests: 0,
    };
  }

  const [commitRows, prRows] = await Promise.all([
    db
      .select({ id: commits.id })
      .from(commits)
      .where(eq(commits.repositoryId, repository.repo.id)),
    db
      .select({ id: pullRequests.id })
      .from(pullRequests)
      .where(eq(pullRequests.repositoryId, repository.repo.id)),
  ]);

  const config = repository.integration.config ?? {};
  const lastSyncedAt =
    typeof config["lastSyncedAt"] === "string" ? config["lastSyncedAt"] : null;

  return {
    configured: true,
    fullName,
    repository: {
      id: repository.repo.id,
      defaultBranch: repository.repo.defaultBranch,
      githubId: repository.repo.githubId,
      lastSyncedAt,
    },
    commits: commitRows.length,
    pullRequests: prRows.length,
  };
}

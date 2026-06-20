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

const GITHUB_API_URL = "https://api.github.com";
const DEFAULT_SYNC_LIMIT = 30;

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

function githubHeaders(token: string): HeadersInit {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "user-agent": "flare-mvp-github-sync",
    "x-github-api-version": "2022-11-28",
  };
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

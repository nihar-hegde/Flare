import { relations, sql } from "drizzle-orm";
import {
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ─────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────
export const userRoleEnum = pgEnum("user_role", ["owner", "admin", "member"]);

export const severityEnum = pgEnum("severity", [
  "critical",
  "high",
  "medium",
  "low",
]);

export const incidentStatusEnum = pgEnum("incident_status", [
  "open",
  "investigating",
  "resolved",
  "ignored",
]);

export const investigationStatusEnum = pgEnum("investigation_status", [
  "pending",
  "running",
  "complete",
  "failed",
]);

export const integrationProviderEnum = pgEnum("integration_provider", [
  "sentry",
  "github",
  "slack",
  "email",
]);

export const integrationKindEnum = pgEnum("integration_kind", [
  "source", // emits incidents (Sentry, etc.)
  "context", // enriches incidents (GitHub)
  "sink", // receives reports (Slack, email)
]);

export const changeTypeEnum = pgEnum("change_type", [
  "pull_request",
  "commit",
  "deployment",
  "feature_flag",
]);

export const notificationChannelEnum = pgEnum("notification_channel", [
  "slack",
  "email",
]);

export const notificationStatusEnum = pgEnum("notification_status", [
  "pending",
  "sent",
  "failed",
]);

export const activityTypeEnum = pgEnum("activity_type", [
  "ingested",
  "investigation_started",
  "investigation_completed",
  "investigation_failed",
  "notified",
  "status_changed",
  "comment",
]);

// ─────────────────────────────────────────────────────────────
// Tenancy (single hardcoded org/user for now; ready for Supabase Auth)
// ─────────────────────────────────────────────────────────────
export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// When Supabase Auth lands, `id` will map to `auth.users.id` (this becomes a profile table).
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  email: text("email").notNull().unique(),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  role: userRoleEnum("role").notNull().default("owner"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ─────────────────────────────────────────────────────────────
// Integrations & repositories
// ─────────────────────────────────────────────────────────────
export const integrations = pgTable("integrations", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  provider: integrationProviderEnum("provider").notNull(),
  kind: integrationKindEnum("kind").notNull(),
  status: text("status").notNull().default("connected"),
  externalAccountId: text("external_account_id"),
  config: jsonb("config").$type<Record<string, unknown>>().default({}),
  // Secret material (tokens). Move to a vault / Supabase secrets before prod.
  credentials: jsonb("credentials").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const repositories = pgTable("repositories", {
  id: uuid("id").primaryKey().defaultRandom(),
  integrationId: uuid("integration_id")
    .notNull()
    .references(() => integrations.id, { onDelete: "cascade" }),
  owner: text("owner").notNull(),
  name: text("name").notNull(),
  fullName: text("full_name").notNull(),
  defaultBranch: text("default_branch").notNull().default("main"),
  githubId: text("github_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ─────────────────────────────────────────────────────────────
// Incidents (central entity)
// ─────────────────────────────────────────────────────────────
export const incidents = pgTable("incidents", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  sourceIntegrationId: uuid("source_integration_id").references(
    () => integrations.id,
    { onDelete: "set null" },
  ),
  // Dedupe / grouping keys from the source (e.g. Sentry issue id + fingerprint).
  externalId: text("external_id"),
  fingerprint: text("fingerprint"),
  title: text("title").notNull(),
  culprit: text("culprit"),
  service: text("service"),
  environment: text("environment"),
  errorType: text("error_type"),
  errorMessage: text("error_message"),
  severity: severityEnum("severity").notNull().default("high"),
  status: incidentStatusEnum("status").notNull().default("open"),
  releaseVersion: text("release_version"),
  permalink: text("permalink"),
  occurrenceCount: integer("occurrence_count").notNull().default(1),
  affectedUsers: integer("affected_users"),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolution: text("resolution"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => [
  // At most ONE active incident per (org, fingerprint). This makes incident
  // grouping atomic: under a flood of identical errors, the DB lets exactly one
  // INSERT win and forces the rest down the upsert/update path — so we only ever
  // investigate once per error. Resolved/ignored incidents are excluded so a
  // recurrence after resolution legitimately opens a fresh (regression) incident.
  uniqueIndex("incidents_active_fingerprint_idx")
    .on(table.organizationId, table.fingerprint)
    .where(sql`${table.status} not in ('resolved', 'ignored')`),
]);

// Individual occurrences / raw webhook payloads.
export type StackFrame = {
  filename: string;
  function?: string;
  lineno?: number;
  colno?: number;
  inApp?: boolean;
  context?: string;
};

export const events = pgTable("events", {
  id: uuid("id").primaryKey().defaultRandom(),
  incidentId: uuid("incident_id")
    .notNull()
    .references(() => incidents.id, { onDelete: "cascade" }),
  stackTrace: jsonb("stack_trace").$type<StackFrame[]>().default([]),
  raw: jsonb("raw").$type<Record<string, unknown>>(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }),
  receivedAt: timestamp("received_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ─────────────────────────────────────────────────────────────
// Code context (repo-scoped, independent of incidents)
// ─────────────────────────────────────────────────────────────
export const pullRequests = pgTable("pull_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  repositoryId: uuid("repository_id")
    .notNull()
    .references(() => repositories.id, { onDelete: "cascade" }),
  number: integer("number").notNull(),
  title: text("title").notNull(),
  body: text("body"),
  author: text("author"),
  branch: text("branch"),
  baseBranch: text("base_branch"),
  mergeCommitSha: text("merge_commit_sha"),
  filesChanged: jsonb("files_changed").$type<string[]>().default([]),
  additions: integer("additions"),
  deletions: integer("deletions"),
  url: text("url"),
  mergedAt: timestamp("merged_at", { withTimezone: true }),
});

export const commits = pgTable("commits", {
  id: uuid("id").primaryKey().defaultRandom(),
  repositoryId: uuid("repository_id")
    .notNull()
    .references(() => repositories.id, { onDelete: "cascade" }),
  sha: text("sha").notNull(),
  message: text("message"),
  author: text("author"),
  filesChanged: jsonb("files_changed").$type<string[]>().default([]),
  url: text("url"),
  authoredAt: timestamp("authored_at", { withTimezone: true }),
});

export const deployments = pgTable("deployments", {
  id: uuid("id").primaryKey().defaultRandom(),
  repositoryId: uuid("repository_id")
    .notNull()
    .references(() => repositories.id, { onDelete: "cascade" }),
  releaseVersion: text("release_version"),
  environment: text("environment"),
  commitSha: text("commit_sha"),
  url: text("url"),
  deployedAt: timestamp("deployed_at", { withTimezone: true }),
});

// ─────────────────────────────────────────────────────────────
// AI investigations
// ─────────────────────────────────────────────────────────────
export type SuggestedFix = {
  title: string;
  detail: string;
  action: "rollback" | "code_change" | "config_change" | "investigate";
};

// One entry per agent step (tool call) — powers the explainability view.
export type AgentStep = {
  index: number;
  tool: string;
  input?: unknown;
  output?: unknown;
  reasoning?: string;
};

export const investigations = pgTable("investigations", {
  id: uuid("id").primaryKey().defaultRandom(),
  incidentId: uuid("incident_id")
    .notNull()
    .references(() => incidents.id, { onDelete: "cascade" }),
  status: investigationStatusEnum("status").notNull().default("pending"),
  rootCause: text("root_cause"),
  confidence: integer("confidence"), // 0-100
  summary: text("summary"),
  reasoning: text("reasoning"),
  suggestedFixes: jsonb("suggested_fixes").$type<SuggestedFix[]>().default([]),
  evidence: jsonb("evidence").$type<string[]>().default([]),
  // The agent's tool-call trace, for the explainability panel.
  steps: jsonb("steps").$type<AgentStep[]>().default([]),
  similarIncidentId: uuid("similar_incident_id").references(
    () => incidents.id,
    { onDelete: "set null" },
  ),
  model: text("model"),
  tokens: integer("tokens"),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Ranked suspect changes — the change-correlation layer.
export const incidentSuspects = pgTable("incident_suspects", {
  id: uuid("id").primaryKey().defaultRandom(),
  incidentId: uuid("incident_id")
    .notNull()
    .references(() => incidents.id, { onDelete: "cascade" }),
  investigationId: uuid("investigation_id").references(
    () => investigations.id,
    { onDelete: "cascade" },
  ),
  changeType: changeTypeEnum("change_type").notNull(),
  // Typed nullable links — exactly one is set depending on changeType.
  pullRequestId: uuid("pull_request_id").references(() => pullRequests.id, {
    onDelete: "cascade",
  }),
  commitId: uuid("commit_id").references(() => commits.id, {
    onDelete: "cascade",
  }),
  deploymentId: uuid("deployment_id").references(() => deployments.id, {
    onDelete: "cascade",
  }),
  label: text("label").notNull(),
  likelihood: integer("likelihood").notNull().default(0), // 0-100
  rank: integer("rank"),
  rationale: text("rationale"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ─────────────────────────────────────────────────────────────
// Delivery & timeline (notifications dormant until Slack/email wired)
// ─────────────────────────────────────────────────────────────
export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  incidentId: uuid("incident_id")
    .notNull()
    .references(() => incidents.id, { onDelete: "cascade" }),
  investigationId: uuid("investigation_id").references(
    () => investigations.id,
    { onDelete: "set null" },
  ),
  channel: notificationChannelEnum("channel").notNull(),
  target: text("target"),
  status: notificationStatusEnum("status").notNull().default("pending"),
  payload: jsonb("payload").$type<Record<string, unknown>>(),
  error: text("error"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const activityLog = pgTable("activity_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  incidentId: uuid("incident_id")
    .notNull()
    .references(() => incidents.id, { onDelete: "cascade" }),
  type: activityTypeEnum("type").notNull(),
  message: text("message"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  actor: text("actor").notNull().default("system"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ─────────────────────────────────────────────────────────────
// Relations
// ─────────────────────────────────────────────────────────────
export const organizationsRelations = relations(organizations, ({ many }) => ({
  users: many(users),
  integrations: many(integrations),
  incidents: many(incidents),
}));

export const usersRelations = relations(users, ({ one }) => ({
  organization: one(organizations, {
    fields: [users.organizationId],
    references: [organizations.id],
  }),
}));

export const integrationsRelations = relations(
  integrations,
  ({ one, many }) => ({
    organization: one(organizations, {
      fields: [integrations.organizationId],
      references: [organizations.id],
    }),
    repositories: many(repositories),
  }),
);

export const repositoriesRelations = relations(
  repositories,
  ({ one, many }) => ({
    integration: one(integrations, {
      fields: [repositories.integrationId],
      references: [integrations.id],
    }),
    pullRequests: many(pullRequests),
    commits: many(commits),
    deployments: many(deployments),
  }),
);

export const incidentsRelations = relations(incidents, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [incidents.organizationId],
    references: [organizations.id],
  }),
  sourceIntegration: one(integrations, {
    fields: [incidents.sourceIntegrationId],
    references: [integrations.id],
  }),
  events: many(events),
  investigations: many(investigations),
  suspects: many(incidentSuspects),
  notifications: many(notifications),
  activity: many(activityLog),
}));

export const eventsRelations = relations(events, ({ one }) => ({
  incident: one(incidents, {
    fields: [events.incidentId],
    references: [incidents.id],
  }),
}));

export const pullRequestsRelations = relations(pullRequests, ({ one }) => ({
  repository: one(repositories, {
    fields: [pullRequests.repositoryId],
    references: [repositories.id],
  }),
}));

export const commitsRelations = relations(commits, ({ one }) => ({
  repository: one(repositories, {
    fields: [commits.repositoryId],
    references: [repositories.id],
  }),
}));

export const deploymentsRelations = relations(deployments, ({ one }) => ({
  repository: one(repositories, {
    fields: [deployments.repositoryId],
    references: [repositories.id],
  }),
}));

export const investigationsRelations = relations(
  investigations,
  ({ one, many }) => ({
    incident: one(incidents, {
      fields: [investigations.incidentId],
      references: [incidents.id],
    }),
    suspects: many(incidentSuspects),
  }),
);

export const incidentSuspectsRelations = relations(
  incidentSuspects,
  ({ one }) => ({
    incident: one(incidents, {
      fields: [incidentSuspects.incidentId],
      references: [incidents.id],
    }),
    investigation: one(investigations, {
      fields: [incidentSuspects.investigationId],
      references: [investigations.id],
    }),
    pullRequest: one(pullRequests, {
      fields: [incidentSuspects.pullRequestId],
      references: [pullRequests.id],
    }),
    commit: one(commits, {
      fields: [incidentSuspects.commitId],
      references: [commits.id],
    }),
    deployment: one(deployments, {
      fields: [incidentSuspects.deploymentId],
      references: [deployments.id],
    }),
  }),
);

export const notificationsRelations = relations(notifications, ({ one }) => ({
  incident: one(incidents, {
    fields: [notifications.incidentId],
    references: [incidents.id],
  }),
  investigation: one(investigations, {
    fields: [notifications.investigationId],
    references: [investigations.id],
  }),
}));

export const activityLogRelations = relations(activityLog, ({ one }) => ({
  incident: one(incidents, {
    fields: [activityLog.incidentId],
    references: [incidents.id],
  }),
}));

// ─────────────────────────────────────────────────────────────
// Inferred types
// ─────────────────────────────────────────────────────────────
export type Organization = typeof organizations.$inferSelect;
export type User = typeof users.$inferSelect;
export type Integration = typeof integrations.$inferSelect;
export type Repository = typeof repositories.$inferSelect;
export type Incident = typeof incidents.$inferSelect;
export type NewIncident = typeof incidents.$inferInsert;
export type Event = typeof events.$inferSelect;
export type PullRequest = typeof pullRequests.$inferSelect;
export type Commit = typeof commits.$inferSelect;
export type Deployment = typeof deployments.$inferSelect;
export type Investigation = typeof investigations.$inferSelect;
export type NewInvestigation = typeof investigations.$inferInsert;
export type IncidentSuspect = typeof incidentSuspects.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type ActivityLog = typeof activityLog.$inferSelect;

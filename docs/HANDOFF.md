# Flare — Engineering Handoff / Current State

This is the source-of-truth handoff for continuing Flare in a fresh AI/chat session.
Read this before building. It captures what the product is, what is already built,
what changed during the latest session, how to run/test it, and what should come next.

---

## 1. Product Direction

**Current sharp positioning:**

> Flare is an AI production regression investigator for GitHub-connected apps.

The strongest wedge is not "another error tracker" and not "an error tracker with AI."
Existing error trackers already overlap with generic AI root-cause analysis and
suggested fixes. Flare should focus on the narrower job:

1. A production error arrives.
2. Flare extracts stack frames and timing.
3. Flare syncs recent GitHub PR/commit metadata.
4. Flare fetches only targeted source/patch evidence for files on the stack.
5. Flare explains which merged PR likely caused the regression, why, and what
   targeted fix should be made.

**The product promise:**

> "This incident is linked to PR #1. It touched `src/services/refunds.ts`.
> The stack points to line 6. The PR patch introduced the unconditional throw.
> Suggested fix: replace/gate that throw, not just rollback blindly."

**Avoid this positioning:**

> "Flare is an error-tracker replacement."

That is strategically weak. The incumbent error trackers and incident tools
are already moving fast in AI incident response. Flare's near-term value is a lightweight,
evidence-first regression investigator and GitHub-native workflow for small teams
using AI-assisted development.

---

## 2. Tech Stack

| Layer | Tech |
|---|---|
| Monorepo | Turborepo + pnpm 9 |
| Frontend | Next.js 16 App Router, React 19, Tailwind v4, shadcn/ui, lucide icons |
| Backend | Hono on Node, zod, `@hono/zod-validator` |
| DB | Supabase Postgres, Drizzle ORM |
| AI | Vercel AI SDK v6, `@ai-sdk/openai` |
| SDK | `@flare/node-sdk` in `packages/flare-sdk` |
| Demo | Internal `apps/demo` plus standalone GitHub repo |

---

## 3. Repo Layout

```text
apps/
  api/       Hono API, ingest, GitHub sync, investigation engine
  web/       Next.js dashboard
  demo/      local monorepo demo payments API
packages/
  db/        Drizzle schema, client, migrations, seed
  flare-sdk/ Node SDK package, published name is @flare/node-sdk
  ui/        starter shared UI package
docs/
  HANDOFF.md
  DEMO_SCRIPT.md
  PITCH.md
  AI_IMPACT_STATEMENT.md
```

There is also a separate local demo repo:

```text
/Users/niharhegde/Developer/Projects/flare-demo-payments-api
```

It is pushed to:

```text
github.com/nihar-hegde/flare-demo-payments-api
```

That separate repo is important because GitHub context should represent a real
customer repo, not the Flare monorepo itself.

---

## 4. Current Git State

Recent commits:

```text
e36f308 Add GitHub code context sync with token-based MVP, improve AI investigation with file truncation and occurrence-based analysis
fac6c84 Rename flare-sdk package to node-sdk and add Web API support for request/trace context extraction
58e8632 Add ingest API endpoint with authentication and flare-sdk package
76db0bf init
```

Current working tree at the time of this handoff includes uncommitted changes for
targeted GitHub code evidence and report-quality improvements:

```text
apps/api/src/lib/ai/prompt.ts
apps/api/src/lib/ai/schema.ts
apps/api/src/lib/ai/tools.ts
apps/api/src/services/github-sync.ts
apps/api/src/services/investigations.ts
```

These changes add:

- `get_stack_frame_source`
- `get_pr_file_patch`
- source/patch context budgets
- source-inspection prompt guidance
- confidence cap when no source/patch was inspected
- better suggested-fix guidance to prefer targeted code changes over default rollback

Do not overwrite these changes. Commit them when ready.

---

## 5. Environment

API env lives in:

```text
apps/api/.env
```

Important values:

```bash
PORT=8080
CORS_ORIGIN=http://localhost:3000
INGEST_API_KEY=dev-flare-ingest-key

DATABASE_URL=...
DIRECT_URL=...

OPENAI_API_KEY=...
INVESTIGATOR_MODEL=openai:gpt-4o
SUMMARIZER_MODEL=openai:gpt-4o-mini

GITHUB_TOKEN=...
GITHUB_OWNER=nihar-hegde
GITHUB_REPO=flare-demo-payments-api
GITHUB_DEFAULT_BRANCH=main
```

GitHub token permissions needed:

- Metadata: read
- Contents: read
- Pull requests: read
- Commit statuses: read is harmless but not essential yet

Security note: a GitHub token was pasted into chat earlier. It should be rotated
and replaced in `apps/api/.env`.

Supabase gotcha:

- Use pooler connection strings.
- Runtime `DATABASE_URL`: transaction pooler, port `6543`.
- Migration `DIRECT_URL`: session pooler, port `5432`.
- Drizzle client uses `prepare: false`.

---

## 6. Database

Schema source:

```text
packages/db/src/schema.ts
```

Important tables:

- `organizations`
- `users`
- `integrations`
- `repositories`
- `incidents`
- `events`
- `pull_requests`
- `commits`
- `deployments`
- `investigations`
- `incident_suspects`
- `notifications`
- `activity_log`

The schema is sufficient for the current MVP. No new migration was required for:

- ingest
- events/raw payloads
- GitHub PR/commit metadata
- AI investigation results
- agent tool traces

Tenancy is still hardcoded:

```text
apps/api/src/lib/tenant.ts
CURRENT_ORG_ID = 00000000-0000-0000-0000-000000000001
```

Future auth should replace this with an org resolved from the authenticated
session/API key.

DB commands:

```bash
pnpm --filter @repo/db db:generate
pnpm --filter @repo/db db:migrate
pnpm --filter @repo/db db:seed
pnpm --filter @repo/db db:studio
```

---

## 7. API: What Is Built

API root:

```text
apps/api
```

Main endpoints:

```text
GET  /api/health
GET  /api/incidents
GET  /api/incidents/:id
POST /api/incidents/:id/investigate
POST /api/ingest
GET  /api/github/status
POST /api/github/sync
```

### Ingest

Files:

```text
apps/api/src/routes/ingest.ts
apps/api/src/services/ingest.ts
apps/api/src/lib/shared-api-key.ts
```

`POST /api/ingest` accepts SDK payloads with:

- service/environment/release
- error type/message
- stack trace
- exception
- request context
- trace context
- breadcrumbs
- spans
- tags/user/extra/metadata

Auth:

```text
Authorization: Bearer <INGEST_API_KEY>
```

or

```text
x-flare-api-key: <INGEST_API_KEY>
```

Storage:

- Creates/updates `incidents`
- Inserts each occurrence into `events`
- Stores rich raw payload in `events.raw`
- Logs timeline entries in `activity_log`

Current behavior:

- New incident triggers investigation.
- Repeat occurrence also triggers fresh investigation.
- Repeat investigation uses the latest event time, not the old first-seen time.

That repeat behavior is deliberate for the demo: merge bad PR, trigger same crash
again, and Flare re-evaluates with fresh GitHub context.

### GitHub Sync

Files:

```text
apps/api/src/routes/github.ts
apps/api/src/services/github-sync.ts
apps/api/src/services/code-context.ts
```

Token-based MVP, not OAuth yet.

`POST /api/github/sync`:

- requires shared API key
- fetches configured repo metadata
- fetches recent commits
- fetches per-commit changed files
- fetches recently merged PRs
- fetches per-PR changed files
- upserts into `integrations`, `repositories`, `commits`, `pull_requests`

`GET /api/github/status`:

- returns configured repo, DB row counts, last sync timestamp
- intentionally not protected right now; it does not expose secrets

Investigation automatically calls sync before loading context:

```text
apps/api/src/services/investigations.ts
```

So users should not need to manually call `/api/github/sync` during the product
flow. The endpoint is mainly a dev/debug escape hatch.

### Targeted GitHub Code Evidence

File:

```text
apps/api/src/services/github-sync.ts
```

Built helpers:

- `toRepoRelativePath(filename)`
- `getGithubFileSourceWindow({ filename, line, radius, ref })`
- `getGithubPullRequestFilePatch({ number, filename })`

These use GitHub API read permissions to fetch only narrow code context:

- source window around stack-frame line
- PR patch for one file

Budgets:

- max source radius: 80 lines
- max source response: 20k chars
- max patch response: 20k chars
- path must resolve inside configured GitHub repo
- `node_modules` paths are rejected

Verified against real demo repo:

- absolute local stack path resolved to `src/services/refunds.ts`
- source fetch returned line 6 throw
- PR #1 patch fetch returned the exact added throwing code

---

## 8. AI Investigation Engine

Files:

```text
apps/api/src/lib/ai/provider.ts
apps/api/src/lib/ai/schema.ts
apps/api/src/lib/ai/tools.ts
apps/api/src/lib/ai/context.ts
apps/api/src/lib/ai/prompt.ts
apps/api/src/lib/ai/investigator.ts
apps/api/src/lib/correlation.ts
apps/api/src/services/investigations.ts
apps/api/src/services/code-context.ts
```

Current flow:

1. `startInvestigation` deletes previous investigation rows for the incident and
   inserts a new `running` row.
2. `processInvestigation` syncs GitHub context if configured.
3. `loadInvestigationContext` loads latest event stack trace, repo metadata,
   PRs/commits/deployments, similar resolved incidents, and deterministic
   candidate ranking.
4. `investigate` runs an agentic Vercel AI SDK loop with tools and structured
   output.
5. On failure/timeout, fallback uses a single structured `generateObject` call.
6. Results are persisted into `investigations`, `incident_suspects`, and
   `activity_log`.

Tools currently exposed to the AI:

- `get_stack_trace`
- `list_recent_changes`
- `get_pull_request`
- `get_file_blame`
- `get_stack_frame_source`
- `get_pr_file_patch`
- `find_similar_incidents`

AI context budget rules:

- list recent changes returns max 10 PRs/commits/deployments
- max 12 files per recent change response
- max 30 files in PR detail
- PR body truncated to 1200 chars
- commit messages truncated to 400 chars
- max 3 source files per investigation
- max 2 PR patches per investigation
- max 40k chars total source/patch context per investigation

Confidence calibration:

- If the agent did not inspect source or PR patch, confidence is capped at 85.
- If it inspected source/patch, higher confidence is allowed.

Prompt guidance:

- Prefer targeted `code_change` fixes when exact source/patch evidence reveals
  the faulty behavior.
- Rollback should be an emergency mitigation, not the default only fix.
- Do not recommend generic infra checks when inspected code clearly explains the
  failure.

---

## 9. SDK

Package:

```text
packages/flare-sdk
```

Published package name in `package.json`:

```text
@flare/node-sdk
```

Exports:

- `init`
- `captureException`
- `addBreadcrumb`
- `addSpan`
- `runWithContext`
- `flush`
- Express-like request/error middleware helpers
- Web/fetch request helpers:
  - `requestContextFromWebRequest`
  - `traceContextFromWebHeaders`

Implementation details:

- Uses `AsyncLocalStorage`
- Parses stack traces
- Redacts sensitive headers
- Sends JSON payloads to `/api/ingest`
- Uses `Authorization: Bearer <apiKey>`
- Source label now uses `@flare/node-sdk`

The API key belongs in both places for local testing:

- Flare API `.env`: `INGEST_API_KEY=dev-flare-ingest-key`
- Customer/demo app `.env`: `FLARE_INGEST_API_KEY=dev-flare-ingest-key`

---

## 10. Demo Apps

### Internal Demo

Path:

```text
apps/demo
```

This is the monorepo-local demo payments API. It is useful for local development
because `pnpm dev` can run it with the rest of the monorepo.

Routes include:

- `GET /health`
- `GET /api/checkout`
- `POST /api/checkout`
- `GET /api/customers/:id`
- `GET /api/inventory/:sku`
- `GET /crash/:scenario`

Scenarios include:

- `db-pool`
- `payment-timeout`
- `coupon-null`
- `missing-profile`
- `stale-inventory`

### Standalone Demo Repo

Path:

```text
/Users/niharhegde/Developer/Projects/flare-demo-payments-api
```

Remote:

```text
git@github.com:nihar-hegde/flare-demo-payments-api.git
```

This repo vendors the current local SDK under:

```text
packages/flare-node-sdk
```

Important tested PR:

```text
PR #1 — feat: add legacy refund processing endpoint
```

It added:

- `src/services/refunds.ts`
- `POST /api/refunds`

The route throws:

```text
ConnectionTimeoutError: Failed to connect to legacy refund gateway...
```

The latest successful report proved:

- Flare re-investigated an existing incident on a second occurrence.
- It fetched source via `get_stack_frame_source`.
- It fetched PR patch via `get_pr_file_patch`.
- It correctly diagnosed that `processRefundTransaction` unconditionally throws.

---

## 11. Web Dashboard

Path:

```text
apps/web
```

Built:

- incident list
- incident detail
- root cause panel
- confidence meter
- change correlation
- suggested fixes
- evidence panel
- agent trace
- stack trace
- timeline
- manual "Investigate" button
- optional Supabase realtime refresher

Current limitation:

- It displays absolute stack paths. A later UI polish should show repo-relative
  paths where possible.
- It does not yet show source snippets/patch snippets as first-class UI panels;
  they appear inside "How Flare investigated" tool outputs.

---

## 12. Tested End-to-End Flow

Real tested flow:

1. Created/pushed standalone demo repo.
2. Created feature branch in demo repo.
3. Added refund endpoint that throws.
4. Opened and merged PR #1.
5. Pulled main locally.
6. Ran Flare API/web and demo separately.
7. Called refund API.
8. SDK posted event to `/api/ingest`.
9. Flare created/reused incident and triggered investigation.
10. Investigation auto-synced GitHub metadata.
11. Agent fetched source and PR patch.
12. Dashboard report identified PR #1 and exact throwing code.

This is the current strongest demo.

---

## 13. What Is Built

Built:

- DB schema and seed
- Hono API
- Incident list/detail API
- Ingest endpoint with shared API-key auth
- Incident grouping and event storage
- Auto-investigation for new and repeated occurrences
- Node SDK
- Internal monorepo demo app
- Standalone demo repo
- Token-based GitHub sync
- GitHub status endpoint
- Targeted GitHub source-window fetch
- Targeted GitHub PR patch fetch
- AI agent tools and structured report schema
- Confidence calibration
- Dashboard list/detail
- Agent trace UI
- Suggested fixes/evidence/suspects UI
- Full local verification commands passing

Verified commands recently:

```bash
pnpm --filter api check-types
pnpm --filter api lint
pnpm --filter api build
pnpm check-types
pnpm lint
pnpm build
```

Notes:

- `pnpm lint` passes but `@repo/db` has pre-existing warnings:
  - `DIRECT_URL` and `DATABASE_URL` not listed in `turbo.json`
  - unused `boolean` import in `packages/db/src/schema.ts`
- `pnpm build` may need network because Next fetches Google Fonts.

---

## 14. What Is Left To Build

P0 product hardening:

- Commit current working tree.
- Rotate GitHub token that was pasted into chat.
- Add tests for:
  - ingest grouping
  - repeated occurrence re-investigation
  - GitHub path normalization
  - source/patch fetch budget limits
  - confidence cap
- Normalize absolute stack paths to repo-relative paths in stored events/UI.
- Show source/patch evidence in dedicated UI panels, not only raw tool output.
- Improve error classification in SDK/demo so dashboard type is not
  `Error: ConnectionTimeoutError...`; use custom error names.

P1 product direction:

- GitHub App workflow:
  - comment on suspect merged PR
  - open GitHub issue for production regression
  - optionally draft follow-up fix PR
- Slack/Linear delivery:
  - send concise incident report to Slack
  - create Linear issue with evidence and fix recommendation
- Auth/API-key management:
  - real org/user model
  - per-org ingest keys
  - key rotation
  - remove hardcoded `CURRENT_ORG_ID`
- GitHub OAuth/App install:
  - replace env token
  - repo picker
  - multi-repo support

P2 integrations:

- Third-party error-tracker webhook ingestion.
  - Useful as an input source.
  - Not a strategic differentiator by itself; incumbents' own AI features overlap.
- Datadog/New Relic ingestion.
- Deployments provider integration: Vercel/Railway/Fly/Render/GitHub Releases.
- OpenTelemetry/log ingestion for richer traces.

P3 AI quality:

- Generate a "copy to Cursor/Claude Code" fix prompt.
- Validate generated report against deterministic evidence before persisting.
- Add confidence bands and "why not higher" explanation.
- Add historical incident memory beyond exact fingerprint/error type.
- Add code-owner/team routing.

---

## 15. Recommended Next Build Order

1. **Commit the current code evidence + docs changes.**
2. **Add tests for the high-risk backend logic.**
3. **Add GitHub PR/issue comment output.**
   - This is more differentiated than yet another ingestion source.
   - It makes Flare GitHub-native and gives a viral demo artifact.
4. **Improve dashboard evidence UI.**
   - Render source snippets and PR patches cleanly.
5. **Add auth/API-key management.**
6. **Then add third-party error-tracker ingestion as a source.**

Do not spend the next session building a full error-tracker replacement.

---

## 16. Runbook

Start from clean ports:

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN
lsof -nP -iTCP:8080 -sTCP:LISTEN
lsof -nP -iTCP:4000 -sTCP:LISTEN
```

Run Flare:

```bash
cd /Users/niharhegde/Developer/Projects/Flare
pnpm dev
```

Run standalone demo:

```bash
cd /Users/niharhegde/Developer/Projects/flare-demo-payments-api
pnpm dev
```

Trigger refund incident:

```bash
curl -X POST http://127.0.0.1:4000/api/refunds \
  -H "content-type: application/json" \
  -d '{"transactionId":"txn_test_123"}'
```

Manual GitHub status:

```bash
curl http://localhost:8080/api/github/status
```

Manual GitHub sync, only for debugging:

```bash
curl -X POST http://localhost:8080/api/github/sync \
  -H "x-flare-api-key: dev-flare-ingest-key"
```

---

## 17. Ports

Default ports:

- Web: `3000`
- API: `8080`
- Demo: `4000`

Temporary ports used in previous testing:

- `8091`
- `4502`

Before running dev servers, close any stale listeners on these ports.

---

## 18. Strategic Notes For The Next AI

Be ruthless about differentiation:

- Incumbent error trackers already do AI issue analysis and suggested fixes.
- Do not build generic "AI RCA over error-tracker events" as the main product.
- Build a GitHub-native production regression workflow:
  - comment on the offending PR
  - produce evidence-linked fix suggestions
  - generate follow-up issue/PR
  - focus on teams merging AI-generated code quickly

The current MVP is credible because it now uses real source/patch evidence. The
next step is to turn that evidence into an action in the developer's workflow.

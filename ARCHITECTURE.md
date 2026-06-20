# Flare — Architecture & Plan

> **Flare — The AI Incident Investigator**
> When production breaks, Flare automatically correlates error reports, code changes,
> and deployments to identify the most likely root cause and suggest a resolution.

Monitoring tools answer **"what is broken?"** Flare answers **"why is it broken,
which change caused it, and what should we do next?"**

---

## 1. Product vision

Flare sits between your observability tools and your humans, collapsing the manual
"jump between the error tracker, GitHub, and Slack" investigation into one automated agent.

```
Error tracker / observability detects an error
        │  webhook (error type, stack trace, release, impact)
        ▼
   FLARE ingests + dedupes → creates an Incident
        │
        ├─ pulls code context from GitHub
        │  (merged PRs to main, recent commits, release→commit mapping,
        │   blame on the files in the stack trace)
        │
        ▼
   AI agent investigates: correlates stack trace ↔ code changes
   → root cause, ranked suspect changes, confidence, evidence, suggested fix
        │
        ▼
   delivers report → live dashboard (+ Slack / email later)
```

**The core insight:** the magic is linking a specific stack frame to the exact PR/commit
that caused it. The error tracker gives `src/db/pool.ts:42` + a release tag; GitHub says that file
was changed 15 minutes ago in PR #284. Flare connects those two facts automatically and
explains the reasoning. That is the demo headline.

---

## 2. Tech stack

| Layer | Choice |
|---|---|
| Monorepo | Turborepo + pnpm workspaces |
| Frontend | Next.js 16 (App Router) + React 19 + Tailwind v4 (`apps/web`) |
| Backend | Hono + Node server (`apps/api`) |
| Database | Supabase Postgres |
| ORM / migrations | Drizzle ORM + drizzle-kit (`packages/db`) |
| AI engine | Vercel AI SDK (provider-agnostic) — OpenAI now, swappable per task |
| Live updates | Supabase Realtime |
| Delivery (later) | Slack, email (Resend) |

### Key decisions

- **Provider-agnostic AI via the Vercel AI SDK.** Models are selected per task through
  env vars (`INVESTIGATOR_MODEL`, `SUMMARIZER_MODEL`) in `provider:model` form. OpenAI is
  active now (using existing credits); Anthropic/Google can be switched on without code
  changes.
- **Agentic investigation engine.** The model is given tools and decides which to call to
  build its case (vs. a single templated call). This is the AI centerpiece. Guardrails:
  step cap (`stopWhen`), token/time budget, and a single-shot structured fallback so the
  demo never hangs.
- **Single hardcoded workspace for now.** One org + one user are seeded with fixed UUIDs.
  `organizations`/`users` tables exist so Supabase Auth is a later drop-in, not a rewrite
  (every tenant-scoped table already carries `organization_id`).
- **Delivery = live dashboard for the MVP.** The `notifications` table exists but is
  dormant until Slack/email are wired.
- **Code data is repo-scoped, not incident-scoped.** PRs/commits/deployments exist
  independently; the link to an incident is the `incident_suspects` correlation layer with
  a likelihood score.

---

## 3. Repository layout

```
apps/
  web/            Next.js dashboard
  api/            Hono API (webhooks, REST, investigation orchestrator)
packages/
  db/             Drizzle schema, client, migrations, seed   ← @repo/db
  ui/             shared React components
  eslint-config/  shared ESLint
  typescript-config/ shared tsconfig
```

The API loads `apps/api/.env` via `dotenv/config`. `packages/db` scripts read the same
`.env` (drizzle.config + a `load-env` side-effect module).

---

## 4. Feature set (MVP vs Stretch)

**Ingestion (sources)**
- [MVP] SDK ingest endpoint → normalized incident (error, stack trace, release, impact)
- [MVP] API-key authentication on ingest
- [MVP] Dedupe/grouping (one fingerprint → one incident; repeats bump `occurrence_count`)
- [MVP] Fast-ack: ingest returns immediately; investigation runs async
- [Stretch] Additional error sources behind the same pipeline (generic JSON, webhooks)

**Code context (GitHub)**
- [MVP] Fetch merged PRs to default branch + recent commits
- [MVP] Map release → git SHA; map stack-trace files → changed files
- [Stretch] PR diffs + `git blame` on the failing lines

**AI investigation engine (hero)**
- [MVP] Agentic tool-calling loop producing a structured report
- [MVP] Change correlation: pre-rank by file overlap + timing, model finalizes ranking
- [MVP] Persisted agent trace (`investigations.steps`) → explainability panel
- [Stretch] Similar-incident matching via pgvector
- [Stretch] Feedback loop (mark report correct/incorrect)

**Delivery (sinks)**
- [MVP] Live dashboard via Supabase Realtime
- [Later] Slack (channel post, then interactive actions)
- [Later] Email (Resend)

**Dashboard (Next.js)**
- [MVP] Incident list (service, severity, status, time, confidence)
- [MVP] Incident detail: error + stack trace, ranked suspects (correlation bars),
  evidence panel, suggested fixes, linked PRs/commits, activity timeline
- [MVP] Live updates (incidents + reports stream in without refresh)
- [Stretch] "Ask Flare" chat, analytics (MTTR, top root causes), one-click postmortem

### Agentic engine — tools

Implemented with `generateText({ model, tools, stopWhen })` + structured final output
(`experimental_output: Output.object({ schema })`).

| Tool | Returns |
|---|---|
| `get_stack_trace` | frames (file, function, line, in_app) for the incident |
| `list_recent_changes` | merged PRs + commits to the default branch in a window |
| `get_pr` / `get_commit_diff` | the diff for a suspect change |
| `get_file_blame` | last commit/author to touch the failing line |
| `find_similar_incidents` | past incidents with similar fingerprint *(stretch)* |

---

## 5. Database schema

13 tables (see `packages/db/src/schema.ts` for the source of truth).

**Tenancy** — `organizations`, `users` (single hardcoded pair for now; `users.id` will map
to `auth.users.id` once Supabase Auth lands).

**Integrations** — `integrations` (provider × kind: source/context/sink, config +
credentials), `repositories` (GitHub repos under a github integration).

**Incidents** — `incidents` (central entity: error metadata, severity, status, release,
dedupe keys, counts, timestamps), `events` (individual occurrences + raw payload + stack
trace).

**Code context** (repo-scoped) — `pull_requests`, `commits`, `deployments`.

**Investigation** — `investigations` (root cause, confidence, reasoning, suggested fixes,
evidence, **agent step trace**, model, token usage, status), `incident_suspects` (ranked
candidate changes with typed nullable FKs to PR/commit/deployment + likelihood + rationale).

**Delivery & timeline** — `notifications` (dormant until Slack/email), `activity_log`
(per-incident timeline powering the UI and future postmortems).

Dropped from v0: `jira_tickets` and `feature_flags` as first-class tables — we can't assume
every customer uses them. They return later as source/context integrations and as
`change_type` values on `incident_suspects`.

---

## 6. Build phases

- **Phase 0 — DB foundation** ✅ **DONE**
  `packages/db` package, full Drizzle schema, migration applied to Supabase, seed with the
  demo narrative (hardcoded org/user, Payments incident, PR #284, ranked suspects, agent
  trace, historical incident). DB is live via the IPv4 connection pooler.

- **Phase 1 — API** (next)
  DB client export, REST (`GET /api/incidents`, `GET /api/incidents/:id`), the agentic
  investigation orchestrator with mocked GitHub/ingest tool implementations over seed data,
  `POST /api/incidents/:id/investigate`, exported `AppType` for typed web calls.

- **Phase 2 — Web**
  Dashboard list → incident detail (stack trace, ranked suspects, agent trace/evidence,
  fixes) + Supabase Realtime live updates.

- **Later**
  Real SDK ingest + GitHub API behind the tool interfaces; a dummy hosted app with
  routes/buttons that intentionally throw errors to drive end-to-end demos; Slack + email
  delivery; Supabase Auth + multi-tenant.

---

## 7. Environment & local setup

Connection notes (Supabase):
- `DATABASE_URL` → **transaction pooler** (port 6543, IPv4). Runtime queries; `prepare:false`.
- `DIRECT_URL` → **session pooler** (port 5432, IPv4). Migrations.
- Do **not** use the direct `db.<ref>.supabase.co` host — it is IPv6-only and unreachable on
  IPv4-only networks.

Commands:
```bash
pnpm install
pnpm --filter @repo/db db:generate   # generate migration from schema
pnpm --filter @repo/db db:migrate    # apply to Supabase
pnpm --filter @repo/db db:seed       # load demo data
pnpm --filter @repo/db db:studio     # browse data
pnpm dev                             # run web + api
```

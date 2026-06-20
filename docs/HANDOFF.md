# Flare — Engineering Handoff / Context

A complete snapshot for continuing development in a fresh session. Read this top to bottom and
you'll have the full picture: the product, the architecture, what's built, what's not, the
gotchas, and the recommended build order.

---

## 1. The product (vision)

**Flare — the AI Incident Investigator.** A production error fires → Flare ingests it → an
**agentic AI** correlates the error's stack trace against recent code changes → produces a ranked
root cause with confidence, evidence, suggested fixes, and a visible reasoning trace → shown on a
live dashboard. Monitoring tools answer *"what broke?"* — Flare answers *"why, which change caused
it, and what to do next."*

**Full product flow (target):**
1. User signs up for Flare.
2. Connects their **GitHub via OAuth**.
3. Installs the **Flare SDK** in their backend and sets up an **API key**.
4. Enables error/crash tracing + logging.
5. On any crash/error, the SDK intercepts it (Sentry-style) with full details and sends it to Flare.
6. Flare stores it, then **auto-investigates** using the SDK's logs/stack trace **plus code context
   from the GitHub API**.
7. Flare returns a detailed report: root cause, ranked suspect changes, evidence, suggested fixes,
   and **a ready-to-paste prompt for an AI coding agent** (Cursor/Claude Code) containing all the
   context needed to fix the issue. *(This last piece is a NEW feature — not yet built.)*

**The "aha":** linking a specific stack frame to the exact PR that caused it — *"error is in
`src/db/pool.ts:42`, changed 15 min ago in PR #284, which added unbounded retries."*

**Context:** built for AIBoomi Startup Weekend (24h hackathon). Perks available: **$100 OpenAI
credits**, **$50 Fastrouter** (LLM router — fits our provider-agnostic model registry), **Scalekit**
(auth — useful for the OAuth/API-key layer), Neysa infra. Judging weights: Technical Execution 25%,
Problem 20%, Innovation 20%, UX 15%, Business 10%, Presentation 10%.

---

## 2. Tech stack

| Layer | Tech |
|---|---|
| Monorepo | Turborepo + pnpm (v9) |
| Frontend | Next.js **16** (App Router, Turbopack) · React 19 · Tailwind v4 · **shadcn/ui** (radix base, nova preset, neutral, lucide icons) · next-themes |
| Backend | Hono (Node, `@hono/node-server`) · zod + `@hono/zod-validator` |
| DB | Supabase Postgres · **Drizzle ORM** + drizzle-kit |
| AI | **Vercel AI SDK v6** + `@ai-sdk/openai` v3 (agentic tool-calling + structured output) |
| Types across apps | Hono RPC (`hc<AppType>`) |

---

## 3. Repo layout

```
apps/
  web/    Next.js dashboard (committed)
  api/    Hono API — read layer (committed) + AI engine (UNCOMMITTED)
packages/
  db/        Drizzle schema, client, migrations, seed (committed)
  ui/ · eslint-config/ · typescript-config/   (scaffolding)
docs/
  ARCHITECTURE.md · PITCH.md · AI_IMPACT_STATEMENT.md · DEMO_SCRIPT.md · HANDOFF.md (this file)
README.md · LICENSE (MIT)
```
There is **no** `apps/demo` or `packages/flare-sdk` yet — those are to be built.

---

## 4. Git state

**Committed** (most recent first): `91fb0bf` shadcn styling · `79960ab` detail dashboard ·
`68453a7` incidents API routes/services/serializers · `ac72630` architecture docs + db re-init ·
`6d1890a` db package init · `d41fde0` api port 8080.

**UNCOMMITTED working tree (the entire AI engine + docs)** — commit this early:
- `apps/api/package.json` (added `ai`, `@ai-sdk/openai`), `pnpm-lock.yaml`
- `apps/api/src/lib/ai/` — `provider.ts`, `schema.ts`, `tools.ts`, `context.ts`, `prompt.ts`, `investigator.ts`
- `apps/api/src/lib/correlation.ts`
- `apps/api/src/services/code-context.ts`, `apps/api/src/services/investigations.ts`
- `apps/api/src/routes/incidents.ts` (added `POST /:id/investigate`)
- `apps/web/components/investigate-button.tsx`, `apps/web/app/incidents/[id]/page.tsx`
- `README.md`, `LICENSE`, `docs/PITCH.md`, `docs/AI_IMPACT_STATEMENT.md`, `docs/DEMO_SCRIPT.md`

The AI engine **type-checks cleanly** but has **never run against a real model** (the
`OPENAI_API_KEY` in `apps/api/.env` is still the `sk-...` placeholder).

---

## 5. Database (Supabase Postgres + Drizzle)

Schema source of truth: `packages/db/src/schema.ts`. **13 tables**, migrated to Supabase and
seeded with a demo narrative (Payments connection-pool incident, PR #284, ranked suspects, agent
trace, a resolved historical incident).

**Tables:** `organizations`, `users` (anticipate Supabase Auth — `users.id` will map to
`auth.users.id`), `integrations` (provider × kind: source/context/sink), `repositories`,
`incidents`, `events` (raw payload + `stackTrace` jsonb), `pull_requests`, `commits`,
`deployments`, `investigations` (rootCause, confidence, summary, reasoning, suggestedFixes jsonb,
evidence jsonb, **steps** jsonb = agent trace, model, tokens, status), `incident_suspects` (ranked
candidate changes with typed nullable FKs to PR/commit/deployment + likelihood + rationale),
`notifications` (dormant), `activity_log` (timeline).

**Tenancy:** single hardcoded workspace. `CURRENT_ORG_ID` in `apps/api/src/lib/tenant.ts` =
`00000000-0000-0000-0000-000000000001` (matches the seed). Every tenant-scoped table has
`organization_id`, so multi-tenant later is column-fill, not a rewrite.

**⚠️ Supabase connection gotcha (important):** the *direct* host `db.<ref>.supabase.co` is
**IPv6-only** and unreachable on IPv4 networks. We use the **connection pooler**:
- `DATABASE_URL` → transaction pooler, port **6543**, client uses `prepare: false`.
- `DIRECT_URL` → session pooler, port **5432** (drizzle-kit migrations).

**DB commands:** `pnpm --filter @repo/db db:generate | db:migrate | db:seed | db:studio`.

---

## 6. API (Hono) — `apps/api`

Structure: `routes/` (HTTP) → `services/` (DB queries) → `serializers/` (DTOs). Env validated in
`src/lib/env.ts` (zod); `.env` loaded via `import "dotenv/config"` in `src/index.ts`.

**Endpoints:**
- `GET /api/health`
- `GET /api/incidents` — list with latest investigation summary + top suspect
- `GET /api/incidents/:id` — full nested detail (event/stack trace, investigation+steps, ranked
  suspects with linked changes, timeline)
- `POST /api/incidents/:id/investigate` — fast-acks `202` with the new investigation id, runs the
  agent in the background (`startInvestigation` then fire-and-forget `processInvestigation`)

**RPC:** `app.ts` builds the app by **chaining** so `export type AppType = typeof app` carries the
route schema. The API package exposes it via `exports: { "./app": "./src/app.ts" }`; the web client
imports `import type { AppType } from "api/app"`. `tsup` config has `noExternal: [/^@repo\//]` to
bundle the workspace `@repo/db`. The API declares `drizzle-orm` directly (pinned `^0.45.2` to match
`@repo/db`).

### The AI engine (`apps/api/src/lib/ai/` + services)

- **`provider.ts`** — `createProviderRegistry({ openai })`; `resolveModel("openai:gpt-4o")`. Model
  chosen by `INVESTIGATOR_MODEL` env (`<provider>:<model>`). Adding Anthropic/Google = one line +
  the `@ai-sdk/*` dep. (Could route via Fastrouter using OpenAI-compatible base URL.)
- **`schema.ts`** — `investigationReportSchema` (Zod): `rootCause`, `confidence` (0-100),
  `summary`, `reasoning`, `suspects[]` (changeType, identifier, label, likelihood, rationale),
  `suggestedFixes[]` (title, detail, action), `evidence[]`. This is the model↔DB contract.
- **`tools.ts`** — 5 agent tools over an **in-memory context snapshot** (fast, deterministic):
  `get_stack_trace`, `list_recent_changes`, `get_pull_request`, `get_file_blame`,
  `find_similar_incidents`. These mirror the real Sentry/GitHub integrations — same shapes,
  swappable backing.
- **`context.ts`** — `InvestigationContext` (incident, stackFrames, repos, PRs/commits/deployments,
  pre-ranked `candidates`, `similarIncidents`) + `CandidateChange`.
- **`prompt.ts`** — `SYSTEM_PROMPT`, `buildUserPrompt(ctx)`, `buildFallbackPrompt(ctx)`.
- **`investigator.ts`** — `investigate(ctx)`: primary path is agentic `generateText({ tools,
  experimental_output: Output.object(schema), stopWhen: stepCountIs(8),
  abortSignal: timeout(60s) })`; on failure/timeout falls back to a single `generateObject`. Returns
  `{ report, steps, model, tokens, usedFallback }`. `toAgentSteps()` flattens tool calls into the
  persisted trace.
- **`correlation.ts`** — deterministic pre-ranking: `buildCandidates` scores each change by file
  overlap with the stack trace (`sameFile` handles path-suffix/basename) + timing proximity.
  Hint for the agent + fallback ranking.
- **`services/code-context.ts`** — `loadInvestigationContext(orgId, incidentId)`: loads incident +
  latest event's stack trace + connected repos' recent changes + similar resolved incidents +
  candidates. Reads from DB (currently seeded data).
- **`services/investigations.ts`** — `startInvestigation` (deletes prior, inserts `running` row,
  logs activity), `processInvestigation` (loads context → runs agent → persists; catches all
  failures → marks `failed`), `persistResult` (writes investigation + `incident_suspects` +
  activity), `resolveSuspects` (maps model suspects back to real PR/commit/deployment rows by
  identifier — grounding/anti-hallucination).

---

## 7. Web (Next 16) — `apps/web`

- **Data:** `lib/api.ts` — typed `hc<AppType>` client; response types via `InferResponseType`
  (no duplication). `fetchIncidents()`, `fetchIncident(id)`.
- **Pages:** `app/page.tsx` (list, `force-dynamic`, Active/Resolved groups), `app/incidents/[id]/
  page.tsx` (detail — **async `params`**, status-aware: handles no-investigation / running /
  failed / complete), `app/incidents/[id]/not-found.tsx`.
- **Components:** `badges`, `confidence-meter` (Meter), `section` (shadcn Card), `incident-card`,
  `site-header` (Flame brand), `stack-trace`, `suspect-list` (correlation bars), `evidence-panel`,
  `suggested-fixes`, `agent-trace`, `timeline`, `investigate-button` (POSTs to `/investigate` then
  refreshes), `realtime-refresher` (Supabase Realtime, **graceful no-op** without env),
  `theme-provider` (next-themes, system dark mode), `components/ui/*` (shadcn).
- **Styling:** shadcn tokens (`bg-card`, `text-muted-foreground`, `border`) + orange brand accent
  (#f97316) + semantic status hues (red/amber/emerald/sky).
- **Env:** `NEXT_PUBLIC_API_URL` (defaults to `http://localhost:8080`). Optional realtime:
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (+ `alter publication
  supabase_realtime add table incidents, investigations;`).

---

## 8. What's BUILT vs NOT

**Built ✅**
- DB schema + migration + seed (committed)
- API read layer: incidents list/detail (committed)
- Dashboard: list + detail with all panels, shadcn UI (committed)
- Agentic AI engine + correlation + `/investigate` flow (UNCOMMITTED, type-checks, never run live)
- Submission docs: README, PITCH, AI_IMPACT_STATEMENT, DEMO_SCRIPT, LICENSE (UNCOMMITTED)

**NOT built ❌ (the gap to the full product / live demo)**
1. **Ingestion endpoint** — nothing receives real errors yet. Need `POST /api/ingest` (auth via API
   key) → normalize → dedupe/upsert incident + event → **auto-trigger investigation**.
2. **Flare SDK** (`packages/flare-sdk`) — Node error-capture: `init()`, `captureException`,
   `uncaughtException`/`unhandledRejection` hooks, Express/Hono error middleware, stack-frame
   parsing (flag in-app), fire-and-forget POST with API key.
3. **Demo source app** (`apps/demo`) — backend with routes that throw realistic errors, using the
   SDK; its code in a GitHub repo so correlation has real PRs/commits.
4. **GitHub OAuth + live sync** — connect repo via OAuth; `syncRepo()` via Octokit to pull recent
   merged PRs/commits/releases into the tables the agent already reads. (Currently seeded.)
5. **Auth + API-key management** — Supabase Auth (or Scalekit) for sign-up/login; generate + verify
   per-org ingest API keys; real multi-tenant (drop the hardcoded `CURRENT_ORG_ID`).
6. **AI-agent fix prompt** (NEW, from the vision) — generate a copy-paste prompt for Cursor/Claude
   Code containing the error, stack trace, root cause, relevant code, and suggested fix. Add a
   field to the report schema + a "Copy fix prompt" button on the dashboard.
7. **Real `OPENAI_API_KEY`** — drop it in `apps/api/.env` so the engine actually runs (start with
   `gpt-4o-mini` to conserve credits).
8. **Enable Supabase Realtime** — set the `NEXT_PUBLIC_SUPABASE_*` vars + replication, so incidents
   appear live (the refresher is already built).
9. **Delivery sinks** — Slack/email (notifications table is dormant). Stretch.

---

## 9. Recommended build order

**P0 — close the live loop (highest priority):**
1. Commit the existing AI engine.
2. Add real `OPENAI_API_KEY`; do one test run of `/investigate` end-to-end against the seed data.
3. **Ingest endpoint** + auto-investigate (small — persistence + engine already exist).
4. **Flare SDK** (capture + send).
5. **Demo app** with trigger routes/buttons + its repo data in Flare (seed or live GitHub sync).

**P1 — differentiators (high value):**
6. Enable Supabase Realtime (≈5 min, big demo payoff).
7. GitHub OAuth + `syncRepo` (Octokit) for real code context.
8. The **AI-agent fix-prompt** feature (great "wow" + on-vision).
9. API-key auth on ingest (use Scalekit credits if going for real auth).

**P2 — stretch:** Slack/email delivery, pgvector similar-incident matching, AI postmortem, the
"Ask Flare" chat.

---

## 10. Gotchas to carry forward

- **Supabase:** use the pooler, not the IPv6-only direct host (see §5).
- **Next 16:** `params`/`searchParams` are **async** (`await params`); Turbopack is default; Node
  20.9+; `middleware`→`proxy` if ever needed. There's an `AGENTS.md` in `apps/web` telling you to
  read `node_modules/next/dist/docs/` before writing Next code — heed it.
- **RPC types:** keep `app.ts` chained; keep the `api` package's `exports."./app"`; keep `tsup`
  `noExternal: [/^@repo\//]`.
- **drizzle-orm version** must match between `apps/api` and `@repo/db` (`0.45.2`) to avoid duplicate
  type instances.
- **Commit the AI engine** — it's currently only in the working tree.
- Verify after changes: `pnpm check-types`, `pnpm lint`, `pnpm build`, `pnpm dev` (web :3000, api :8080).

---

## 11. Quick start (new machine / new session)

```bash
pnpm install
# apps/api/.env: DATABASE_URL + DIRECT_URL (Supabase pooler) + OPENAI_API_KEY
pnpm --filter @repo/db db:migrate
pnpm --filter @repo/db db:seed
pnpm dev                      # web :3000, api :8080
# try it:
curl http://localhost:8080/api/incidents
# open http://localhost:3000, open an incident, click "Investigate"
```

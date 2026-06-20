# 🔥 Flare — The AI Incident Investigator

> When production breaks, Flare automatically correlates the error with your recent
> code changes to tell you **why it broke, which change caused it, and what to do next** —
> in seconds, not hours.

Monitoring tools answer *“what is broken?”* Flare answers *“why?”*

**Demo:** _<add hosted app / video link here before submission>_

---

## The problem

When a production error fires, the on-call engineer becomes a **human integration layer** —
jumping between the error tracker, GitHub, deployment history, and Slack to answer one
question: *which recent change caused this?* It’s slow, stressful, and usually happens at 3 AM.
The information exists; it’s just scattered, and stitching it together is manual.

## What Flare does

1. **Capture** — drop the `@flare/sdk` into any Node.js backend. It catches unhandled errors
   and sends the stack trace + release/service metadata to Flare. (Sentry/other sources can be
   added later — same pipeline.)
2. **Correlate** — Flare pulls recent merged PRs, commits, and deployments from your connected
   GitHub repo.
3. **Investigate** — an **agentic AI** (OpenAI via the Vercel AI SDK) reasons over the stack
   trace and code changes using tools (`get_stack_trace`, `list_recent_changes`, `get_pull_request`,
   `get_file_blame`, `find_similar_incidents`) to produce a ranked root cause.
4. **Explain** — the dashboard shows the root cause + confidence, ranked suspect changes,
   supporting evidence, suggested fixes, and the agent’s full reasoning trace.

## The “aha”

The magic is linking a specific stack frame to the exact PR that caused it:
*the error is in `src/db/pool.ts:42`, which was changed 15 minutes ago in PR #284, which added
unbounded retries.* Flare makes that connection automatically and explains it.

---

## Tech stack

| Layer | Tech |
|---|---|
| Monorepo | Turborepo + pnpm |
| Frontend | Next.js 16 (App Router) · React 19 · Tailwind v4 · shadcn/ui |
| Backend | Hono (Node) |
| Database | Supabase Postgres · Drizzle ORM |
| AI | Vercel AI SDK · OpenAI (agentic tool-calling + structured output) |
| Ingestion | `@flare/sdk` (Node error-capture package) |
| Live updates | Supabase Realtime |

## Architecture

```
 your backend ──(@flare/sdk)──▶  POST /api/ingest  ──▶  incident + event (Postgres)
                                                              │ auto-trigger
 GitHub repo ──(PRs/commits)──▶  code context  ──────────────┤
                                                              ▼
                                                    Agentic AI investigation
                                              (stack trace ↔ code-change correlation)
                                                              │
                                                              ▼
                                          Dashboard: root cause · ranked suspects ·
                                          evidence · fixes · agent trace  (live)
```

## Repository layout

```
apps/
  web/    Next.js dashboard
  api/    Hono API — ingestion, REST, agentic investigation engine (src/lib/ai)
  demo/   sample backend that throws realistic errors (drives the live demo)
packages/
  db/        Drizzle schema, client, migrations, seed
  flare-sdk/ the Node error-capture SDK
  ui/ · eslint-config/ · typescript-config/
```

## Setup & run

```bash
pnpm install

# 1. Configure env (see apps/api/.env.example)
#    - DATABASE_URL / DIRECT_URL  (Supabase connection pooler — IPv4)
#    - OPENAI_API_KEY             (the investigation engine)

# 2. Database
pnpm --filter @repo/db db:migrate
pnpm --filter @repo/db db:seed     # demo data

# 3. Run everything (web :3000, api :8080)
pnpm dev
```

Open http://localhost:3000.

## Models, data & guardrails

See [docs/AI_IMPACT_STATEMENT.md](docs/AI_IMPACT_STATEMENT.md). In short: OpenAI for tool-use +
structured output; data is the user’s own errors + their GitHub (with permission); guardrails
include a strict output schema, agent step cap + time budget with single-shot fallback, and
grounding every suspect back to a real PR/commit row to prevent fabrication.

## Known limitations

- Single hardcoded workspace (Supabase Auth + multi-tenant is post-hackathon).
- GitHub data is synced per repo; deep `git blame` / diff fetching is roadmap.
- Slack/email delivery and pgvector similarity are stretch features.

## Team

_<names · roles · contacts>_

## License

MIT — see [LICENSE](LICENSE).

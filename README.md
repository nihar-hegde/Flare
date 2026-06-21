# Flare

### Hosted URL
https://flare-web-lovat.vercel.app/

Flare is an AI production regression investigator for GitHub-connected apps.
When production breaks, it links the error to the merged PR or commit that most
likely caused it, shows the evidence, and hands off a targeted fix.

Monitoring tools answer "what broke?" Flare answers "which change broke it, why,
and what should we do next?"

## Demo

- Local dashboard: `http://localhost:3000`
- Local API: `http://localhost:8080`
- Demo payments service: `http://localhost:4000`
- Product demo link: https://flare-web-lovat.vercel.app/
- Pitch deck: [`docs/Flare_AIBoomi_Pitch_Deck.pptx`](docs/Flare_AIBoomi_Pitch_Deck.pptx)
- AI impact statement: [`docs/AI_IMPACT_STATEMENT.md`](docs/AI_IMPACT_STATEMENT.md)

## Problem Statement

When a production error fires, the on-call engineer has to jump between the
error tracker, GitHub, deployment history, logs, and Slack to answer one urgent
question: which recent change caused this?

That workflow gets harder as teams ship more AI-assisted code. The code volume
goes up, but the human mental model does not. Error trackers show the stack
trace; Flare connects the stack trace to the code change that introduced the
failure.

## Users And Context

Flare is built for small engineering teams, founders, and AI-heavy product teams
that ship through GitHub and need faster production debugging without replacing
their existing observability stack.

The first user is the on-call engineer who needs a credible root-cause report in
minutes. The buyer is a technical founder or engineering lead who wants lower
MTTR, fewer rollback guesses, and a safer way to let coding agents help with
production fixes.

## Solution Overview

1. Capture a backend error from `@flare/node-sdk` or the ingest API.
2. Store the incident, latest event, stack trace, request context, breadcrumbs,
   and release metadata.
3. Sync recent GitHub PRs, commits, deployments, source windows, and targeted
   PR patches.
4. Run a bounded AI investigation with tools for stack traces, recent changes,
   file blame, source snippets, patches, and similar incidents.
5. Show a structured report in the dashboard: root cause, confidence, suspects,
   code evidence, suggested fixes, and the agent trace.
6. Hand off the fix as an agent prompt, GitHub issue, PR comment, Slack update,
   or draft fix PR payload.

```text
Backend app
  |  @flare/node-sdk
  v
POST /api/ingest
  |
  v
Incident + event in Postgres
  |
  +--> GitHub sync: PRs, commits, deployments, source, patches
  |
  v
AI investigation engine
  |
  v
Dashboard: root cause, evidence, fixes, trace, handoff
```

## What Is Built

- Node SDK for capturing exceptions, request context, trace headers,
  breadcrumbs, spans, and unhandled errors.
- Hono API with API-key-protected ingest, incident list/detail endpoints,
  manual re-investigation, GitHub sync, and fix-PR handoff routes.
- Supabase Postgres schema and Drizzle migrations for organizations, incidents,
  events, GitHub context, investigations, suspects, notifications, and timeline
  activity.
- AI investigator using the Vercel AI SDK with OpenAI models, tool calling,
  schema-validated output, step limits, timeouts, and fallback analysis.
- Next.js dashboard showing incident summaries, stack traces, suspect changes,
  confidence, evidence, suggested fixes, code evidence, and the full agent
  trace.
- Demo payments API that intentionally throws realistic production-style errors
  so Flare can ingest and investigate them live.

## Tech Stack

| Layer        | Tech                                                           |
| ------------ | -------------------------------------------------------------- |
| Monorepo     | Turborepo, pnpm workspaces                                     |
| Frontend     | Next.js 16, React 19, Tailwind CSS v4, shadcn/ui, lucide-react |
| Backend      | Hono, Node.js, zod                                             |
| Database     | Supabase Postgres, Drizzle ORM                                 |
| AI           | Vercel AI SDK, OpenAI tool calling and structured output       |
| SDK          | `@flare/node-sdk`                                              |
| Demo service | Hono payments API                                              |
| Realtime     | Supabase Realtime, optional                                    |

## Repository Layout

```text
apps/
  web/       Next.js dashboard
  api/       Hono API, ingest, GitHub sync, investigation engine
  demo/      local payments API that drives demo incidents
packages/
  db/        Drizzle schema, migrations, seed data
  flare-sdk/ Node SDK published locally as @flare/node-sdk
  ui/        shared UI primitives
docs/
  AI_IMPACT_STATEMENT.md
  DEMO_SCRIPT.md
  HANDOFF.md
  PITCH.md
```

## Setup And Run

Install dependencies:

```bash
pnpm install
```

Create environment files:

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
cp apps/demo/.env.example apps/demo/.env
```

Configure `apps/api/.env`:

- `DATABASE_URL`: Supabase transaction pooler connection string.
- `DIRECT_URL`: Supabase session pooler connection string for migrations.
- `INGEST_API_KEY`: shared local ingest key, for example
  `dev-flare-ingest-key`.
- `OPENAI_API_KEY`: required for live investigations.
- `GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO`: optional for live GitHub
  context sync.

Prepare the database:

```bash
pnpm --filter @repo/db db:migrate
pnpm --filter @repo/db db:seed
```

Run Flare:

```bash
pnpm dev
```

Run the demo payments API in another terminal:

```bash
pnpm --filter demo dev
```

Open the dashboard:

```text
http://localhost:3000
```

Trigger a demo incident:

```bash
curl http://localhost:4000/crash/db-pool
```

Or use the realistic checkout route:

```bash
curl "http://localhost:4000/api/checkout?scenario=db-pool"
```

## Models And Data

Flare uses OpenAI models through the Vercel AI SDK. The investigation model is
configured with `INVESTIGATOR_MODEL`, defaulting to `openai:gpt-4o`.

Data comes from the user's own systems:

- error events sent by the Flare SDK or ingest API;
- stack traces, request context, breadcrumbs, spans, and release metadata;
- connected GitHub repositories, PRs, commits, deployments, source snippets, and
  targeted PR patches.

No external training dataset is used by the application. GitHub and incident
data should only be connected with permission from the repository owner.

## Evaluation And Guardrails

- Strict zod schemas validate ingest payloads and AI investigation output.
- The agent has a maximum step count and a wall-clock timeout.
- A single-shot structured fallback runs if the tool loop fails.
- Source and patch tools are budgeted so the model receives narrow evidence, not
  a whole repository dump.
- Every suspect is resolved back to a real PR, commit, or deployment row when
  possible.
- Confidence is capped when the model has not inspected source or patch
  evidence.
- The dashboard exposes the agent trace and evidence so engineers can audit the
  reasoning before acting.

## Known Limitations And Risks

- Authentication and multi-tenant organization resolution are not production
  ready; the MVP uses a hardcoded workspace.
- GitHub integration is token-based. A GitHub App install flow is roadmap.
- Live Slack, Linear, and email delivery are roadmap.
- The AI report is an investigation aid, not an automatic production change.
  Engineers should review evidence and run validation before deploying fixes.
- The hosted demo link or screen recording still needs to be added before final
  submission.

## Team

- Name: `<add name>`
- Role: `<add role>`
- Contact: `<add email / phone / LinkedIn>`

## License

MIT. See [`LICENSE`](LICENSE).

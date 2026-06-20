# Flare — Pitch Notes

Copy-ready source for a short deck or spoken pitch.

**Positioning:** Flare is the reliability layer for AI-generated codebases. It links a
production error to the exact change that caused it, proves it with grounded evidence,
and hands a trustworthy fix to the coding agent your team already uses.

---

## Slide 1 — Hook

**Flare**

**Find the change that broke production. Fix it with the agent that wrote it.**

Production error → stack trace → the exact PR/patch that caused it → an evidence-grounded fix.

Speaker note:

> "When production breaks, someone has to figure out which change did it and why.
> Increasingly, no one on the team wrote that code — an AI did. Flare does the
> investigation automatically and hands the fix to a coding agent."

---

## Slide 2 — Problem

**AI writes the code. No one has the mental model.**

- Teams now merge a fast-growing share of AI-generated code.
- Volume of shipped code is exploding; human review capacity is flat.
- When it breaks, the person debugging often did not write it and has no model of it.
- Error trackers tell you *what* failed — not *which change* caused it, or how to fix it.

Speaker note:

> "The painful part isn't seeing an error. It's staring at code nobody on the team
> authored, at 2 AM, trying to figure out which of the last forty merges did this."

---

## Slide 3 — Why Now

**The bottleneck moved from detecting errors to understanding code nobody wrote.**

- AI authorship of merged code crossed a threshold in the last 24 months.
- Stack traces point to files. Git history knows what changed. Agents can inspect both.
- Cheap inference makes per-incident investigation feasible.
- Autonomous fixes are only trustworthy when grounded in real evidence — which is
  exactly what makes "AI fixes AI's bug" safe instead of scary.

Speaker note:

> "The trick is not dumping the repo into a model. The trick is narrow tools —
> stack trace, suspect PRs, source window, patch — and evidence you can audit."

---

## Slide 4 — Demo

**Live regression investigation → grounded fix**

1. Trigger a production crash.
2. Flare ingests the error.
3. Flare links it to the exact PR that introduced it.
4. Flare fetches `src/services/refunds.ts:6` — the line that threw.
5. Flare fetches the PR patch that added it.
6. Flare explains the faulty code path — and hands the evidence to a coding agent
   to produce the fix.

Speaker note:

> "This is not timing correlation. It inspected the line that threw and the patch
> that introduced it — then turned that into a fix an agent can act on."

---

## Slide 5 — How It Works

**SDK + git evidence + agentic investigation + agent handoff**

- `@flare/node-sdk` captures backend errors with stack, request, and trace context.
- Ingest stores incidents and events.
- Repo sync stores recent PRs, commits, and deployments.
- Agent tools inspect stack frames, PR metadata, source windows, and patches —
  fetching only the narrow evidence that overlaps the failure.
- Output is a structured, evidence-linked report and a fix payload a coding agent
  can consume.

Guardrails (why you can trust it):

- schema-validated output
- bounded source/patch context budgets
- confidence is capped when no source/patch was inspected
- every suspect resolves to a real PR/commit record — no fabrication

---

## Slide 6 — Wedge & Why We Win

**Wedge:** the reliability layer for teams shipping AI-generated code.

The insight incumbents are structurally positioned against:

- Error trackers were built for code a human wrote and understands.
- They are systems of record — their incentive is to keep your telemetry *and* your
  fix inside their own product.
- Flare is the **neutral broker**: between whatever error source you use and whatever
  coding agent you use. That neutrality is a position a system-of-record won't take,
  because it commoditizes them.

Honest framing:

> This is a timing-and-positioning bet, grounded in a working evidence-first engine.
> We win by being the connective tissue between production failures and the agents
> that fix them — for the emerging majority of code that no human authored.

---

## Slide 7 — Roadmap

Near-term:

- GitHub App: comment on the suspect PR, open issues, draft fix PRs
- First-class source/patch evidence UI
- Agent handoff: one-click "fix this" to Claude Code / Cursor / others
- Auth + per-org API keys, multi-repo support

Direction:

- Ingest from any error source (be the broker, not a silo)
- Deployment-aware regression bisection
- Per-codebase failure-pattern memory for pre-merge risk signals

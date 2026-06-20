# Demo Script & Run-of-Show

This demo should show the strongest current loop:

> A merged GitHub PR causes a production error. Flare ingests the error, syncs
> GitHub, fetches only the relevant source/patch evidence, and explains the
> exact code path that broke.

---

## Setup Checklist

- [ ] Main Flare monorepo running:

```bash
cd /Users/niharhegde/Developer/Projects/Flare
pnpm dev
```

- [ ] Standalone demo repo running:

```bash
cd /Users/niharhegde/Developer/Projects/flare-demo-payments-api
pnpm dev
```

- [ ] API env has:

```bash
INGEST_API_KEY=dev-flare-ingest-key
GITHUB_OWNER=nihar-hegde
GITHUB_REPO=flare-demo-payments-api
GITHUB_TOKEN=<rotated read-only token>
OPENAI_API_KEY=<real key>
```

- [ ] Browser open to `http://localhost:3000`
- [ ] Demo API on `http://127.0.0.1:4000`
- [ ] Flare API on `http://localhost:8080`
- [ ] A pre-investigated incident is available as backup

---

## Best Demo Incident

Use the standalone demo repo PR:

```text
PR #1 — feat: add legacy refund processing endpoint
```

It added:

```text
src/services/refunds.ts
POST /api/refunds
```

The code throws a timeout error unconditionally. This is ideal because Flare can
prove causality using stack frame + PR patch.

Trigger it:

```bash
curl -X POST http://127.0.0.1:4000/api/refunds \
  -H "content-type: application/json" \
  -d '{"transactionId":"txn_test_123"}'
```

Expected incident title:

```text
ConnectionTimeoutError: Failed to connect to legacy refund gateway...
```

Expected strong report:

- Root cause: `processRefundTransaction` unconditionally throws/simulates a
  timeout.
- Suspect: PR #1.
- Evidence:
  - top stack frame is `src/services/refunds.ts:6`
  - PR #1 modified `src/services/refunds.ts`
  - source window shows the throw
  - PR patch introduced that throw
- Suggested fix should prefer targeted code change:
  - remove/gate the simulated throw
  - implement real gateway call/error handling
  - rollback only as mitigation

---

## 90-Second Talk Track

**0:00 — Hook**

> "This is Flare. It finds which merged PR caused a production error, then shows
> the evidence from the stack trace and GitHub patch."

**0:10 — Trigger**

Run the refund curl.

> "That just threw a real error from a running Node service using our SDK."

**0:20 — Incident**

Open/refresh the Flare dashboard.

> "Flare ingested the error, grouped it as an incident, and started investigating."

**0:35 — Reveal**

Open incident detail.

> "It linked the crash to PR #1. But it did not just guess from timing. It fetched
> the exact source around the stack frame and the PR patch that introduced it."

Point to:

1. Root cause.
2. Change correlation.
3. Evidence.
4. "How Flare investigated":
   - `get_stack_frame_source`
   - `get_pr_file_patch`
5. Suggested fix.

**1:15 — Close**

> "The wedge is not another dashboard. It is an evidence-first production
> regression investigator for teams shipping fast with GitHub and AI coding
> agents."

---

## Honest Q&A

**How is this different from the AI features in existing error trackers?**

Existing error trackers were built for code a human wrote and understands, and they
are systems of record — their incentive is to keep your telemetry *and* your fix
inside their own product. Flare is the neutral broker between whatever error source
you use and whatever coding agent you use. The wedge is a GitHub-native production
regression workflow — evidence-linked PR comments, issues, and fix prompts — for
teams shipping a fast-growing share of AI-generated code.

**Are you sending the whole repo to the model?**

No. Flare syncs metadata, then fetches only bounded source windows and PR patches
for files that overlap the stack trace. Current budgets cap source/patch context.

**How do you avoid hallucination?**

Every suspect resolves to real DB rows from GitHub. The model has explicit tools,
structured output, evidence bullets, and confidence is capped if it never
inspects source/patch evidence.

**What is not production-ready yet?**

Auth, per-org API keys, GitHub App install, UI rendering for source/patch
evidence, tests, and delivery to Slack/GitHub/Linear.

---

## If Live AI Is Slow

Use a pre-investigated incident. The important proof is the agent trace showing:

```text
get_stack_frame_source
get_pr_file_patch
```

Those two tools distinguish the current demo from shallow PR metadata matching.

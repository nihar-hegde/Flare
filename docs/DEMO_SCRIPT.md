# Demo Script & Run-of-Show

Two formats at AIBoomi: **desk round** (~5 min, judges at your table) and **finals** (3-min live
demo + 2-min Q&A). Same story, different length. Golden rule: **show the “aha” in the first
30–45 seconds.**

---

## Before you present (setup checklist)

- [ ] `pnpm dev` running — web (:3000) + api (:8080) healthy
- [ ] Demo backend running, error buttons reachable
- [ ] Real `OPENAI_API_KEY` set; do **one practice run** so credits/latency are warm
- [ ] Dashboard open on the incident list, browser zoomed for readability
- [ ] **Pre-baked fallback:** one incident already fully investigated, in case live AI is slow
- [ ] Wifi/tethering backup ready

---

## The 90-second core demo (talk track)

**0:00 — Hook (don’t narrate setup).**
> “This is Flare. When a backend throws an error in production, Flare figures out which code
> change caused it. Watch — I’ll break something.”

**0:10 — Trigger the error.**
Switch to the demo app, click **“Checkout”** (or hit the route). It 500s.
> “That just threw a real error in a running Node service.”

**0:20 — Incident appears.**
Switch to the Flare dashboard. The new incident shows up (live, via Realtime).
> “Flare captured it instantly through our SDK — no Sentry, no config. And it’s already
> investigating.”

**0:35 — The reveal.** Open the incident.
> “Here’s the root cause: **PR #284 added unbounded retries**, exhausting the DB connection pool —
> **87% confidence**.”

Point to, in order:
1. **Ranked suspects** — “It compared every recent change and ranked PR #284 first.”
2. **Evidence** — “Grounded: the failing file `src/db/pool.ts` is exactly what that PR modified,
   minutes before the error.”
3. **How Flare investigated** — “This is the agent’s actual reasoning trace — it pulled the stack
   trace, found recent changes, and read the PR.”
4. **Suggested fix** — “And it recommends the fix: roll back PR #284.”

**1:20 — Close.**
> “From error to root cause in seconds — no dashboards to dig through. That’s Flare.”

---

## Extending to 3 minutes (finals)

Add after the core demo:
- **Why it’s hard / why now** (15s): “Root cause is correlation across the stack trace and the
  diff — exactly what agentic LLMs unlocked.”
- **Architecture** (20s): SDK → ingest → agentic AI → dashboard; grounded + guardrailed.
- **GTM/vision** (20s): developer-led, free SDK → team plan; Sentry/Datadog become just more
  sources. AI-native observability.

---

## If it crashes (resilience > perfection)

The handbook literally rewards this: *“If your demo crashes, call it chaos-engineering, then show
the fallback.”*
- If the live error doesn’t ingest: “Perfect — chaos engineering. Here’s one we triggered earlier,”
  and open the **pre-baked investigated incident**.
- If the AI is slow: keep talking through the architecture slide; it’ll fill in. Or show the
  pre-baked one and mention the live one will complete in the background.

---

## Anticipated Q&A

- **“Why not just use Sentry?”** Sentry tells you *what* broke; Flare tells you *why* and *which
  change*. We’re AI-native and zero-config — and Sentry becomes just another ingestion source.
- **“How do you stop the AI from hallucinating a cause?”** Every suspect is resolved back to a real
  PR/commit; output is schema-validated; confidence + evidence are explicit; there’s a deterministic
  correlation pre-rank behind the agent.
- **“What if there are 200 recent PRs?”** The agent works from a pre-ranked candidate set (file
  overlap + timing), so it focuses on the few that matter.
- **“Does it need our source code?”** Only metadata + diffs of changed files via GitHub, with
  permission. Errors come from our lightweight SDK.
- **“Business model?”** Free SDK + free tier; paid per-seat/per-event team plan. Land one service,
  expand across repos.

---

## Rubric self-check (100 pts)

| Criterion | Weight | How we hit it |
|---|---|---|
| Problem relevance | 20% | Universal on-call pain; clear user |
| Innovation | 20% | Agentic stack-trace ↔ code-change correlation; own SDK |
| Technical execution | 25% | Full pipeline: SDK, ingest, agentic AI w/ guardrails, live dashboard |
| UX/UI | 15% | Clean shadcn dashboard; evidence + reasoning trace visible |
| Business viability | 10% | Dev-led GTM; ownable AI-native observability wedge |
| Presentation | 10% | Tight 90s demo, “aha” up front, crash fallback ready |

---

## Submission checklist (portal locks Sun 9:30 AM — submit by 9:20)

- [ ] GitHub repo URL (public)
- [ ] `README.md` ✅ (overview, idea, stack, demo link)
- [ ] Demo link — hosted app **or** screen recording (strongly favored)
- [ ] Pitch deck ≤6 slides ([docs/PITCH.md](PITCH.md))
- [ ] AI Impact Statement ≤200 words ([docs/AI_IMPACT_STATEMENT.md](AI_IMPACT_STATEMENT.md))
- [ ] `LICENSE` file (MIT)
- [ ] Record a backup demo video **early** — don’t rely on live wifi at judging

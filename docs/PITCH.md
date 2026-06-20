# Flare — Pitch Deck (≤6 slides)

Copy-ready content. Keep each slide to a few bold lines; speaker notes are what you *say*, not
what's on the slide. Target: land the "aha" in the first 30–45 seconds (open with the demo if you can).

---

## Slide 1 — Title & hook

**🔥 Flare**
**The AI Incident Investigator**

> Production breaks. Flare tells you *which code change caused it* — in seconds.

*Speaker note:* “Every engineer knows the 3 AM page. Something’s down, and you’re frantically
jumping between your error tracker, GitHub, and deploy logs trying to figure out what changed.
Flare does that investigation for you.”

---

## Slide 2 — Problem & who cares

**When prod breaks, the engineer becomes the integration layer.**

- The error tracker says *what* broke. It never says *why*.
- The answer is scattered across logs, GitHub, deploys, and Slack.
- Stitching it together is manual, slow, and stressful → high MTTR.

**Who:** backend / on-call / SRE teams at startups & scaleups running production software.

*Speaker note:* “Monitoring tells you CPU is 95% or latency spiked. It doesn’t tell you that
PR #284 from 15 minutes ago is the reason. A human still has to connect those dots — usually the
most senior person, at the worst possible time.”

---

## Slide 3 — Insight & why now

**Errors carry stack traces. Git carries diffs. LLMs can finally reason across both.**

- Root-cause analysis is fundamentally *correlation* — exactly what agentic LLMs are now good at.
- Tool-use + cheap inference make autonomous, grounded investigation newly possible.
- What needed a senior engineer’s intuition can now be automated and explained.

*Speaker note:* “This wasn’t buildable two years ago. Agentic models that can call tools and
return structured, grounded output are what make Flare possible right now.”

---

## Slide 4 — Solution (LIVE DEMO)

**Drop in our SDK → get autonomous root-cause analysis.**

- Live demo: trigger an error → it appears in Flare → AI investigates → **root cause + culprit PR
  + confidence + fix**, with the agent’s reasoning shown.

*(This slide is mostly the live demo. Show, don’t tell.)*

*Speaker note:* run the demo script — click the error, watch the incident appear, let Flare
name PR #284 at 87% confidence, show evidence + suggested rollback.

---

## Slide 5 — How it works (tech & architecture)

**SDK → Ingest → Agentic AI → Dashboard**

- `@flare/sdk` captures errors from any Node backend; GitHub provides recent changes.
- An **agentic loop** (OpenAI via Vercel AI SDK) correlates the stack trace with code changes
  using tools, then emits a **schema-validated** report.
- Grounded: every suspect resolves to a real PR/commit. Guardrails: step cap, time budget,
  single-shot fallback.
- Stack: Next.js · Hono · Supabase/Drizzle · Vercel AI SDK.

*Speaker note:* “It’s not a prompt that summarizes an error. It’s an agent that investigates —
pulls the stack trace, finds what changed those files, reads the diff, and grounds every claim in
real data.”

---

## Slide 6 — Value, GTM & roadmap

**Value:** cut MTTR from hours to seconds; turn every engineer into an incident commander.

**GTM:** bottom-up, developer-led — free SDK + free tier → team plan (per-seat / per-event).
Land with one backend, expand across services and repos.

**Roadmap:** more sources (Sentry, Datadog) · Slack/PagerDuty delivery · auto-rollback PRs ·
historical learning across incidents.

**Ask:** _<credits / mentorship / pilot users — tailor to the room>_

*Speaker note:* “We own the SDK, so we own the data and the relationship from day one — Sentry
becomes just another source we plug in. The wedge is zero-config AI root cause; the platform is
AI-native observability.”

---

### Design tips
- 6 slides max, ~15 words per slide, one idea each. Big text.
- Use a real screenshot/GIF of the dashboard on Slide 4/5.
- Brand color: Flare orange (#f97316). Dark background reads well on projectors.

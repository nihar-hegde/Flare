# AI Impact Statement

_(~190 words — the submission limit is 200.)_

**What the AI does.** Flare automates production incident root-cause analysis — work that
normally requires a senior engineer correlating an error's stack trace against recent code
changes. An agentic loop ingests the stack trace, then calls tools to list recent merged PRs,
commits, and deployments, inspect a pull request, trace which change last touched a file, and
find similar past incidents. It produces a structured report: ranked suspect changes, a
confidence score, supporting evidence, and concrete suggested fixes.

**Models & why.** OpenAI GPT-4o-class models, via the Vercel AI SDK, chosen for reliable
tool-use and schema-constrained structured output — essential for grounding analysis in real
data rather than free-form prose.

**Data & provenance.** Only the customer's own error events (sent by our SDK) and their
connected GitHub repositories, used with permission. No third-party or proprietary datasets.

**Guardrails.** Output is validated against a strict schema; the agent has a step cap and time
budget with a single-shot fallback so a run always completes; every suspect is resolved back to
a real PR/commit to prevent fabrication; confidence + cited evidence make uncertainty explicit.

**Impact.** Lower MTTR, less 3 AM guesswork, and an auditable reasoning trail engineers can trust.

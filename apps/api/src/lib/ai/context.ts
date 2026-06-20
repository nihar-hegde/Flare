import type {
  Commit,
  Deployment,
  Incident,
  PullRequest,
  StackFrame,
} from "@repo/db";

/**
 * A code change that could plausibly have caused the incident, pre-scored by a
 * deterministic heuristic (file overlap with the stack trace + timing). The
 * agent is given these as a starting point and asked to verify and finalize the
 * ranking with its tools. See `lib/correlation.ts`.
 */
export interface CandidateChange {
  changeType: "pull_request" | "commit" | "deployment";
  /** PR number, commit SHA, or release version — used to resolve back to a row. */
  identifier: string;
  label: string;
  filesChanged: string[];
  occurredAt: Date | null;
  /** Heuristic likelihood, 0-100. */
  score: number;
  /** Human-readable reasons that contributed to the score. */
  reasons: string[];
}

/** A prior resolved incident that resembles the current one (for the agent). */
export interface SimilarIncident {
  id: string;
  title: string;
  errorType: string | null;
  resolution: string | null;
  resolvedAt: Date | null;
}

/**
 * Everything the investigation engine needs, loaded once up front so the agent
 * tools operate over an in-memory snapshot (fast, deterministic, no per-call
 * round-trips). Built by `loadInvestigationContext` in the code-context service.
 */
export interface InvestigationContext {
  organizationId: string;
  incident: Incident;
  analysisTime: Date;
  stackFrames: StackFrame[];
  repositories: { id: string; fullName: string; defaultBranch: string }[];
  pullRequests: PullRequest[];
  commits: Commit[];
  deployments: Deployment[];
  candidates: CandidateChange[];
  similarIncidents: SimilarIncident[];
}

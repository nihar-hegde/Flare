import {
  Activity,
  CheckCircle2,
  FileCode2,
  GitPullRequest,
  Wrench,
} from "lucide-react";
import type { ReactNode } from "react";
import type { IncidentDetail, Investigation } from "@/lib/api";
import { formatNumber, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Meter } from "./confidence-meter";

type Fix = Investigation["suggestedFixes"][number];
type Analysis = NonNullable<Investigation["analysis"]>;
type EvidenceItem = Analysis["keyEvidence"][number];

export function InvestigationOverview({
  incident,
  investigation,
}: {
  incident: IncidentDetail;
  investigation: Investigation;
}) {
  const topSuspect = incident.suspects[0] ?? null;
  const firstFix = investigation.suggestedFixes[0] ?? null;
  const analysis = investigation.analysis;
  const frame = topApplicationFrame(incident.latestEvent?.stackTrace ?? []);
  const evidence = keyEvidence(investigation);
  const failurePoint =
    analysis?.failurePoint ??
    (frame ? formatFrame(frame) : (incident.culprit ?? "Unknown"));
  const eventImpact = `${formatNumber(incident.occurrenceCount)} ${
    incident.occurrenceCount === 1 ? "event" : "events"
  }`;
  const userImpact =
    incident.affectedUsers == null
      ? "affected users unknown"
      : `${formatNumber(incident.affectedUsers)} users`;
  const headline =
    investigation.summary ??
    investigation.rootCause ??
    "Flare completed the investigation.";

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 space-y-2">
          <Badge className={confidenceBadgeClass(investigation.confidence)}>
            <CheckCircle2 className="size-3" />
            {confidenceLabel(investigation.confidence)}
          </Badge>
          <p className="text-base font-semibold leading-relaxed text-foreground">
            {headline}
          </p>
        </div>
        {investigation.confidence != null ? (
          <div className="w-full shrink-0 md:w-56">
            <Meter value={investigation.confidence} label="confidence" />
          </div>
        ) : null}
      </div>

      <div className="grid gap-x-6 gap-y-4 border-y py-4 md:grid-cols-2">
        <Signal
          icon={<GitPullRequest className="size-4" />}
          label="Primary suspect"
          value={topSuspect?.label ?? "No suspect ranked"}
          detail={topSuspect ? `${topSuspect.likelihood}% likelihood` : null}
        />
        <Signal
          icon={<FileCode2 className="size-4" />}
          label="Failure point"
          value={failurePoint}
          detail={incident.errorType}
          mono
        />
        <Signal
          icon={<Activity className="size-4" />}
          label="Impact"
          value={eventImpact}
          detail={`${userImpact} · first seen ${timeAgo(incident.firstSeenAt)}`}
        />
        <Signal
          icon={<Wrench className="size-4" />}
          label="First action"
          value={firstFix?.title ?? "No fix suggested"}
          detail={firstFix ? actionLabel[firstFix.action] : null}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,22rem)]">
        <div className="min-w-0">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Why Flare believes this
          </h3>
          {evidence.length > 0 ? (
            <ul className="mt-2 space-y-2">
              {evidence.map((item, i) => (
                <li key={i} className="min-w-0 rounded-lg border p-3">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <Badge className={evidenceKindClass[item.kind]}>
                      {evidenceKindLabel[item.kind]}
                    </Badge>
                    <span className="min-w-0 break-words text-sm font-semibold">
                      {item.title}
                    </span>
                    {item.reference ? (
                      <code className="break-all text-[11px] text-muted-foreground">
                        {item.reference}
                      </code>
                    ) : null}
                  </div>
                  <p className="mt-1.5 break-words text-sm leading-relaxed text-muted-foreground">
                    {item.detail}
                  </p>
                  <span
                    className={cn(
                      "mt-2 inline-flex text-[11px] font-medium",
                      item.strength === "supports" &&
                        "text-emerald-600 dark:text-emerald-400",
                      item.strength === "rules_out" &&
                        "text-sky-600 dark:text-sky-400",
                      item.strength === "context" && "text-muted-foreground",
                    )}
                  >
                    {evidenceStrengthLabel[item.strength]}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground italic">
              No evidence bullets were recorded.
            </p>
          )}
        </div>

        <div className="min-w-0 border-t pt-4 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {analysis ? "Mechanism" : "Likely cause"}
          </h3>
          {analysis?.mechanism || investigation.rootCause ? (
            <p className="mt-2 break-words text-sm leading-relaxed">
              {analysis?.mechanism ?? investigation.rootCause}
            </p>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground italic">
              No root cause statement recorded.
            </p>
          )}
          {analysis?.confidenceRationale ? (
            <div className="mt-4 border-t pt-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Confidence rationale
              </h3>
              <p className="mt-2 break-words text-sm leading-relaxed text-muted-foreground">
                {analysis.confidenceRationale}
              </p>
              {analysis.confidenceFactors.length ? (
                <ul className="mt-3 space-y-2">
                  {analysis.confidenceFactors.slice(0, 3).map((factor, i) => (
                    <li key={i} className="min-w-0">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <Badge className={confidenceFactorClass[factor.impact]}>
                          {confidenceFactorLabel[factor.impact]}
                        </Badge>
                        <span className="min-w-0 break-words text-sm font-medium">
                          {factor.label}
                        </span>
                      </div>
                      <p className="mt-1 break-words text-xs leading-relaxed text-muted-foreground">
                        {factor.detail}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {analysis?.causalChain.length ? (
        <div className="border-t pt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Causal chain
          </h3>
          <ol className="mt-3 grid gap-3 md:grid-cols-3">
            {analysis.causalChain.map((link, i) => (
              <li key={i} className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="grid size-5 shrink-0 place-items-center rounded bg-muted text-[10px] font-bold text-muted-foreground">
                    {i + 1}
                  </span>
                  <span className="min-w-0 break-words text-sm font-semibold">
                    {link.title}
                  </span>
                </div>
                <p className="mt-1.5 break-words text-sm leading-relaxed text-muted-foreground">
                  {link.detail}
                </p>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {firstFix ? <RecommendedFix fix={firstFix} /> : null}

      {analysis?.validationSteps.length ? (
        <div className="border-t pt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Validate the fix
          </h3>
          <ul className="mt-2 space-y-2">
            {analysis.validationSteps.map((step, i) => (
              <li key={i} className="flex min-w-0 gap-2.5 text-sm">
                <span
                  aria-hidden
                  className="mt-1.5 size-1.5 shrink-0 rounded-full bg-emerald-500"
                />
                <span className="min-w-0 break-words leading-relaxed">
                  {step}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {analysis?.remainingUncertainty.length ? (
        <div className="rounded-lg border bg-muted/30 p-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Remaining uncertainty
          </h3>
          <ul className="mt-2 space-y-1.5">
            {analysis.remainingUncertainty.map((item, i) => (
              <li
                key={i}
                className="break-words text-sm leading-relaxed text-muted-foreground"
              >
                {item}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function Signal({
  icon,
  label,
  value,
  detail,
  mono,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail?: string | null;
  mono?: boolean;
}) {
  return (
    <div className="flex min-w-0 gap-3">
      <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
        {icon}
      </span>
      <div className="min-w-0">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div
          className={cn(
            "mt-0.5 break-words text-sm font-medium leading-snug",
            mono && "font-mono text-xs leading-relaxed",
          )}
        >
          {value}
        </div>
        {detail ? (
          <div className="mt-1 break-words text-xs text-muted-foreground">
            {detail}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function RecommendedFix({ fix }: { fix: Fix }) {
  return (
    <div className="border-t pt-4">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Badge className={actionClass[fix.action]}>
          {actionLabel[fix.action]}
        </Badge>
        <span className="min-w-0 break-words text-sm font-semibold">
          {fix.title}
        </span>
      </div>
      <p className="mt-1.5 break-words text-sm leading-relaxed text-muted-foreground">
        {fix.detail}
      </p>
    </div>
  );
}

function topApplicationFrame(
  frames: NonNullable<IncidentDetail["latestEvent"]>["stackTrace"],
) {
  return frames.find((frame) => frame.inApp !== false) ?? frames[0] ?? null;
}

function formatFrame(
  frame: NonNullable<IncidentDetail["latestEvent"]>["stackTrace"][number],
): string {
  const line = frame.lineno ? `:${frame.lineno}` : "";
  const fn = frame.function ? ` in ${frame.function}` : "";
  return `${frame.filename}${line}${fn}`;
}

function keyEvidence(investigation: Investigation): EvidenceItem[] {
  if (investigation.analysis?.keyEvidence.length) {
    return investigation.analysis.keyEvidence.slice(0, 3);
  }

  return investigation.evidence.slice(0, 3).map((detail) => ({
    title: "Evidence",
    detail,
    kind: "metadata",
    strength: "supports",
    reference: null,
  }));
}

function confidenceLabel(value: number | null): string {
  if (value == null) return "Confidence pending";
  if (value >= 90) return "Very high confidence";
  if (value >= 75) return "High confidence";
  if (value >= 50) return "Moderate confidence";
  return "Low confidence";
}

function confidenceBadgeClass(value: number | null): string {
  if (value == null) return "bg-muted text-muted-foreground";
  if (value >= 75)
    return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
  if (value >= 50) return "bg-amber-500/10 text-amber-700 dark:text-amber-400";
  return "bg-red-500/10 text-red-600 dark:text-red-400";
}

const actionLabel: Record<Fix["action"], string> = {
  rollback: "Rollback",
  code_change: "Code change",
  config_change: "Config change",
  investigate: "Investigate",
};

const actionClass: Record<Fix["action"], string> = {
  rollback: "bg-red-500/10 text-red-600 dark:text-red-400",
  code_change: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  config_change: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  investigate: "bg-muted text-muted-foreground",
};

const evidenceKindLabel: Record<EvidenceItem["kind"], string> = {
  stack_trace: "Stack",
  source: "Source",
  patch: "Patch",
  blame: "Blame",
  timing: "Timing",
  deployment: "Deploy",
  similar_incident: "Prior incident",
  metadata: "Metadata",
};

const evidenceKindClass: Record<EvidenceItem["kind"], string> = {
  stack_trace: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
  source: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  patch: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  blame: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  timing: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  deployment: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
  similar_incident: "bg-purple-500/10 text-purple-600 dark:text-purple-400",
  metadata: "bg-muted text-muted-foreground",
};

const evidenceStrengthLabel: Record<EvidenceItem["strength"], string> = {
  supports: "Supports conclusion",
  rules_out: "Rules out alternative",
  context: "Context",
};

const confidenceFactorLabel: Record<
  Analysis["confidenceFactors"][number]["impact"],
  string
> = {
  raises: "Raises",
  lowers: "Lowers",
};

const confidenceFactorClass: Record<
  Analysis["confidenceFactors"][number]["impact"],
  string
> = {
  raises: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  lowers: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
};

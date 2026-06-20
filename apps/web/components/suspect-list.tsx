import {
  ExternalLink,
  Flag,
  GitCommit,
  GitPullRequest,
  Rocket,
} from "lucide-react";
import type { IncidentSuspect } from "@/lib/api";
import { likelihoodMeterColor } from "@/lib/styles";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

function changeHref(change: IncidentSuspect["change"]): string | null {
  return change?.url ?? null;
}

export function SuspectList({ suspects }: { suspects: IncidentSuspect[] }) {
  if (suspects.length === 0) {
    return (
      <p className="text-sm text-muted-foreground italic">
        No candidate changes found.
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {suspects.map((suspect, i) => {
        const href = changeHref(suspect.change);
        const isTop = i === 0;
        const Icon = changeIcon[suspect.changeType] ?? Flag;
        return (
          <li
            key={suspect.id}
            className={cn(
              "min-w-0 rounded-lg border p-3",
              isTop && "border-orange-500/40 bg-orange-500/5",
            )}
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 gap-3">
                <span
                  className={cn(
                    "grid size-6 shrink-0 place-items-center rounded-lg text-[10px] font-bold",
                    isTop
                      ? "bg-orange-500 text-white"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {suspect.rank ?? i + 1}
                </span>
                <div className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <Badge
                      className={cn(
                        "gap-1",
                        isTop
                          ? "bg-orange-500/10 text-orange-600 dark:text-orange-400"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      <Icon className="size-3" />
                      {changeTypeLabel[suspect.changeType] ?? "Change"}
                    </Badge>
                    <Badge className={likelihoodBadgeClass(suspect.likelihood)}>
                      {likelihoodLabel(suspect.likelihood)}
                    </Badge>
                  </div>
                  {href ? (
                    <a
                      href={href}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-flex max-w-full items-center gap-1 text-sm font-semibold hover:underline"
                    >
                      <span className="min-w-0 truncate">{suspect.label}</span>
                      <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
                    </a>
                  ) : (
                    <span className="mt-2 block truncate text-sm font-semibold">
                      {suspect.label}
                    </span>
                  )}
                </div>
              </div>
              <div className="shrink-0 sm:w-36">
                <div className="flex items-baseline justify-between gap-3 sm:justify-end">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground sm:hidden">
                    Likelihood
                  </span>
                  <span className="text-lg font-bold tabular-nums">
                    {suspect.likelihood}%
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      "h-full rounded-full",
                      likelihoodMeterColor(suspect.likelihood),
                    )}
                    style={{ width: `${suspect.likelihood}%` }}
                  />
                </div>
              </div>
            </div>
            {suspect.rationale ? (
              <p className="mt-3 break-words border-t pt-3 text-sm leading-relaxed text-muted-foreground">
                {suspect.rationale}
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

const changeIcon: Partial<
  Record<IncidentSuspect["changeType"], typeof GitPullRequest>
> = {
  pull_request: GitPullRequest,
  commit: GitCommit,
  deployment: Rocket,
};

const changeTypeLabel: Partial<Record<IncidentSuspect["changeType"], string>> =
  {
    pull_request: "Pull request",
    commit: "Commit",
    deployment: "Deploy",
    feature_flag: "Flag",
  };

function likelihoodLabel(value: number): string {
  if (value >= 85) return "Strong match";
  if (value >= 60) return "Likely";
  if (value >= 25) return "Possible";
  return "Weak";
}

function likelihoodBadgeClass(value: number): string {
  if (value >= 85) return "bg-red-500/10 text-red-600 dark:text-red-400";
  if (value >= 60) return "bg-amber-500/10 text-amber-700 dark:text-amber-400";
  if (value >= 25) return "bg-sky-500/10 text-sky-600 dark:text-sky-400";
  return "bg-muted text-muted-foreground";
}

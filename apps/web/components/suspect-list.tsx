import { ExternalLink } from "lucide-react";
import type { IncidentSuspect } from "@/lib/api";
import { meterColor } from "@/lib/styles";
import { cn } from "@/lib/utils";

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
    <ul className="space-y-4">
      {suspects.map((suspect, i) => {
        const href = changeHref(suspect.change);
        const isTop = i === 0;
        return (
          <li key={suspect.id} className="min-w-0">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className={cn(
                    "grid size-5 shrink-0 place-items-center rounded text-[10px] font-bold",
                    isTop
                      ? "bg-orange-500 text-white"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {suspect.rank ?? i + 1}
                </span>
                {href ? (
                  <a
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-w-0 items-center gap-1 truncate text-sm font-medium hover:underline"
                  >
                    <span className="truncate">{suspect.label}</span>
                    <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
                  </a>
                ) : (
                  <span className="truncate text-sm font-medium">
                    {suspect.label}
                  </span>
                )}
              </div>
              <span className="shrink-0 text-sm font-semibold tabular-nums">
                {suspect.likelihood}%
              </span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
              <div
                className={cn("h-full rounded-full", meterColor(suspect.likelihood))}
                style={{ width: `${suspect.likelihood}%` }}
              />
            </div>
            {suspect.rationale ? (
              <p className="mt-1.5 break-words text-xs leading-relaxed text-muted-foreground">
                {suspect.rationale}
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

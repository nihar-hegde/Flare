import Link from "next/link";
import type { IncidentListItem } from "@/lib/api";
import { formatNumber, timeAgo } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { SeverityBadge, StatusBadge } from "./badges";

export function IncidentCard({ incident }: { incident: IncidentListItem }) {
  const investigation = incident.latestInvestigation;
  const suspect = incident.topSuspect;

  return (
    <Link href={`/incidents/${incident.id}`} className="block">
      <Card className="gap-3 p-4 transition-colors hover:bg-muted/40 hover:ring-foreground/20">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <SeverityBadge severity={incident.severity} />
              <StatusBadge status={incident.status} />
            </div>
            <h3 className="mt-2 truncate font-semibold">{incident.title}</h3>
            <p className="mt-0.5 truncate text-sm text-muted-foreground">
              {incident.service ?? "unknown service"}
              {incident.environment ? ` · ${incident.environment}` : ""}
              {incident.releaseVersion ? ` · ${incident.releaseVersion}` : ""}
            </p>
          </div>
          {investigation?.confidence != null ? (
            <div className="shrink-0 text-right">
              <div className="text-lg font-bold tabular-nums">
                {investigation.confidence}%
              </div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                confidence
              </div>
            </div>
          ) : null}
        </div>

        {investigation?.rootCause ? (
          <p className="line-clamp-2 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Likely cause: </span>
            {investigation.rootCause}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground italic">
            No investigation yet.
          </p>
        )}

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="truncate">
            {suspect ? `Top suspect: ${suspect.label}` : "—"}
          </span>
          <span className="shrink-0">
            {formatNumber(incident.occurrenceCount)} events ·{" "}
            {timeAgo(incident.lastSeenAt)}
          </span>
        </div>
      </Card>
    </Link>
  );
}

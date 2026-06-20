import type { IncidentListItem } from "@/lib/api";
import { severityColor, severityDot, statusColor } from "@/lib/styles";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

export function SeverityBadge({
  severity,
}: {
  severity: IncidentListItem["severity"];
}) {
  return (
    <Badge className={cn("capitalize", severityColor[severity])}>
      <span className={cn("size-1.5 rounded-full", severityDot[severity])} />
      {severity}
    </Badge>
  );
}

export function StatusBadge({
  status,
}: {
  status: IncidentListItem["status"];
}) {
  return (
    <Badge className={cn("capitalize", statusColor[status])}>{status}</Badge>
  );
}

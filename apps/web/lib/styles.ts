import type { IncidentListItem } from "./api";

type Severity = IncidentListItem["severity"];
type Status = IncidentListItem["status"];

// Status semantics use fixed hues (not theme tokens) so red always reads as
// "bad"; surfaces/text elsewhere use shadcn tokens for automatic dark mode.
export const severityColor: Record<Severity, string> = {
  critical: "bg-red-500/10 text-red-600 dark:text-red-400",
  high: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
  medium: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  low: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
};

export const statusColor: Record<Status, string> = {
  open: "bg-red-500/10 text-red-600 dark:text-red-400",
  investigating: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  resolved: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  ignored: "bg-muted text-muted-foreground",
};

export const severityDot: Record<Severity, string> = {
  critical: "bg-red-500",
  high: "bg-orange-500",
  medium: "bg-amber-500",
  low: "bg-sky-500",
};

/** Bar fill color for confidence: high means well-supported, not more severe. */
export function confidenceMeterColor(value: number): string {
  if (value >= 75) return "bg-emerald-500";
  if (value >= 50) return "bg-amber-500";
  return "bg-red-500";
}

/** Bar fill color for suspect likelihood: high means this change is risky. */
export function likelihoodMeterColor(value: number): string {
  if (value >= 70) return "bg-red-500";
  if (value >= 40) return "bg-amber-500";
  return "bg-muted-foreground/40";
}

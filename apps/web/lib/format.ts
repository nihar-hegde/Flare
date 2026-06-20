/** Human-friendly "time ago" for an ISO timestamp (rendered on the server). */
export function timeAgo(iso: string | null): string {
  if (!iso) return "—";

  const diffMs = Date.now() - new Date(iso).getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;

  return formatDateTime(iso);
}

const dateTimeFormat = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return dateTimeFormat.format(new Date(iso));
}

export function formatNumber(n: number | null): string {
  if (n === null) return "—";
  return n.toLocaleString("en-US");
}

import type { ActivityEntry } from "@/lib/api";
import { timeAgo } from "@/lib/format";

export function Timeline({ entries }: { entries: ActivityEntry[] }) {
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground italic">No activity yet.</p>;
  }

  return (
    <ol className="space-y-3">
      {entries.map((entry) => (
        <li key={entry.id} className="flex gap-3 text-sm">
          <span
            aria-hidden
            className="mt-1.5 size-2 shrink-0 rounded-full bg-muted-foreground/40"
          />
          <div className="min-w-0 flex-1">
            <p>{entry.message ?? entry.type}</p>
            <p className="text-xs text-muted-foreground">
              {entry.actor} · {timeAgo(entry.createdAt)}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

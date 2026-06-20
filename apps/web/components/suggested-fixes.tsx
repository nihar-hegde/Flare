import type { Investigation } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

type Fix = Investigation["suggestedFixes"][number];

const actionLabel: Record<Fix["action"], string> = {
  rollback: "Rollback",
  code_change: "Code change",
  config_change: "Config change",
  investigate: "Investigate",
};

const actionColor: Record<Fix["action"], string> = {
  rollback: "bg-red-500/10 text-red-600 dark:text-red-400",
  code_change: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  config_change: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  investigate: "bg-muted text-muted-foreground",
};

export function SuggestedFixes({ fixes }: { fixes: Fix[] }) {
  if (fixes.length === 0) {
    return (
      <p className="text-sm text-muted-foreground italic">
        No fixes suggested.
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {fixes.map((fix, i) => (
        <li key={i} className="rounded-lg border p-3">
          <div className="flex items-center gap-2">
            <Badge className={cn(actionColor[fix.action])}>
              {actionLabel[fix.action]}
            </Badge>
            <span className="text-sm font-semibold">{fix.title}</span>
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">{fix.detail}</p>
        </li>
      ))}
    </ul>
  );
}

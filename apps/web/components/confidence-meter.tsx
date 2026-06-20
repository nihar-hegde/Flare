import { confidenceMeterColor } from "@/lib/styles";
import { cn } from "@/lib/utils";

/** Horizontal 0-100 meter for investigation confidence. */
export function Meter({ value, label }: { value: number; label?: string }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className="flex items-center gap-3">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full", confidenceMeterColor(clamped))}
          style={{ width: `${clamped}%` }}
        />
      </div>
      <span className="w-12 text-right text-sm font-semibold tabular-nums">
        {clamped}%
      </span>
      {label ? (
        <span className="text-xs text-muted-foreground">{label}</span>
      ) : null}
    </div>
  );
}

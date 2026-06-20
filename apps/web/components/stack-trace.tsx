import type { IncidentEvent } from "@/lib/api";
import { cn } from "@/lib/utils";

export function StackTrace({ frames }: { frames: IncidentEvent["stackTrace"] }) {
  if (frames.length === 0) {
    return (
      <p className="text-sm text-muted-foreground italic">
        No stack trace captured.
      </p>
    );
  }

  return (
    <ol className="space-y-1 font-mono text-xs">
      {frames.map((frame, i) => (
        <li
          key={`${frame.filename}-${frame.lineno ?? i}`}
          className={cn(
            "rounded px-2 py-1",
            frame.inApp ? "bg-muted" : "text-muted-foreground",
          )}
        >
          <span>{frame.filename}</span>
          {frame.lineno != null ? (
            <span className="text-orange-600 dark:text-orange-400">
              :{frame.lineno}
            </span>
          ) : null}
          {frame.function ? (
            <span className="text-muted-foreground"> in {frame.function}</span>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

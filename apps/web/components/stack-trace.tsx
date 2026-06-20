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
    <ol className="max-h-[34rem] space-y-1 overflow-y-auto pr-1 font-mono text-xs">
      {frames.map((frame, i) => (
        <li
          key={`${i}-${frame.filename}-${frame.lineno ?? "unknown"}-${frame.colno ?? "unknown"}-${frame.function ?? "anonymous"}`}
          className={cn(
            "rounded-lg px-3 py-2 leading-relaxed",
            frame.inApp
              ? "bg-muted text-foreground"
              : "text-muted-foreground",
          )}
        >
          <div className="break-all">
            <span>{frame.filename}</span>
            {frame.lineno != null ? (
              <span className="text-orange-600 dark:text-orange-400">
                :{frame.lineno}
              </span>
            ) : null}
            {frame.colno != null ? (
              <span className="text-orange-600/80 dark:text-orange-400/80">
                :{frame.colno}
              </span>
            ) : null}
          </div>
          {frame.function ? (
            <div className="mt-0.5 break-words text-muted-foreground">
              in {frame.function}
            </div>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

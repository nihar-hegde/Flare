import type { Investigation } from "@/lib/api";
import { cn } from "@/lib/utils";

type Step = Investigation["steps"][number];

function stringify(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  return JSON.stringify(value, null, 2);
}

export function AgentTrace({ steps }: { steps: Step[] }) {
  if (steps.length === 0) {
    return (
      <p className="text-sm text-muted-foreground italic">
        No agent steps recorded for this investigation.
      </p>
    );
  }

  return (
    <ol className="space-y-5">
      {steps.map((step) => {
        const input = stringify(step.input);
        const output = stringify(step.output);
        return (
          <li key={`${step.index}-${step.tool}`} className="relative min-w-0 pl-8">
            <span className="absolute top-0.5 left-0 grid size-5 place-items-center rounded-full bg-orange-500 text-[10px] font-bold text-white">
              {step.index + 1}
            </span>
            <code className="block break-all text-sm font-semibold">
              {step.tool}
            </code>
            {step.reasoning ? (
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {step.reasoning}
              </p>
            ) : null}
            {input ? (
              <TraceValue tone="muted" label="Input" value={input} />
            ) : null}
            {output ? (
              <TraceValue label="Output" value={output} />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function TraceValue({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "muted";
}) {
  return (
    <div className="mt-2 min-w-0">
      <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <pre
        className={cn(
          "max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg border px-3 py-2 font-mono text-xs leading-relaxed",
          tone === "muted"
            ? "border-transparent bg-transparent text-muted-foreground"
            : "border-transparent bg-muted text-foreground",
        )}
      >
        <code>{value}</code>
      </pre>
    </div>
  );
}

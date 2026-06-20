import type { Investigation } from "@/lib/api";

type Step = Investigation["steps"][number];

function stringify(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  return JSON.stringify(value);
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
    <ol className="space-y-4">
      {steps.map((step) => {
        const input = stringify(step.input);
        const output = stringify(step.output);
        return (
          <li key={step.index} className="relative pl-6">
            <span className="absolute top-1 left-0 grid size-4 place-items-center rounded-full bg-orange-500 text-[9px] font-bold text-white">
              {step.index + 1}
            </span>
            <code className="text-sm font-semibold">{step.tool}</code>
            {step.reasoning ? (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {step.reasoning}
              </p>
            ) : null}
            {input ? (
              <p className="mt-1 font-mono text-xs text-muted-foreground">
                → {input}
              </p>
            ) : null}
            {output ? (
              <p className="mt-1 rounded bg-muted px-2 py-1 font-mono text-xs">
                {output}
              </p>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

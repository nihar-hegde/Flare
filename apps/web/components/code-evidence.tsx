import { ExternalLink } from "lucide-react";
import type { Investigation } from "@/lib/api";
import {
  extractCodeEvidence,
  type DiffRow,
  type PatchEvidence,
  type SourceEvidence,
} from "@/lib/evidence";
import { cn } from "@/lib/utils";

export function CodeEvidence({ steps }: { steps: Investigation["steps"] }) {
  const { sources, patches } = extractCodeEvidence(steps);
  if (sources.length === 0 && patches.length === 0) return null;

  return (
    <div className="space-y-4">
      {sources.map((source) => (
        <SourceWindow key={source.key} source={source} />
      ))}
      {patches.map((patch) => (
        <DiffView key={patch.key} patch={patch} />
      ))}
    </div>
  );
}

function Frame({
  eyebrow,
  path,
  right,
  children,
  truncated,
}: {
  eyebrow: string;
  path: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  truncated?: boolean;
}) {
  return (
    <figure className="overflow-hidden rounded-xl border">
      <figcaption className="flex items-center justify-between gap-3 border-b bg-muted/40 px-3 py-2">
        <div className="min-w-0">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {eyebrow}
          </div>
          <code className="block truncate text-xs font-medium">{path}</code>
        </div>
        {right ? <div className="flex shrink-0 items-center gap-3">{right}</div> : null}
      </figcaption>
      <div className="max-h-80 overflow-auto">
        <div className="min-w-max">{children}</div>
      </div>
      {truncated ? (
        <div className="border-t bg-muted/30 px-3 py-1 text-[10px] text-muted-foreground">
          Truncated by Flare&apos;s context budget.
        </div>
      ) : null}
    </figure>
  );
}

function GithubLink({ url }: { url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex shrink-0 items-center gap-1 text-[11px] text-orange-600 hover:underline dark:text-orange-400"
    >
      GitHub
      <ExternalLink className="size-3" />
    </a>
  );
}

function SourceWindow({ source }: { source: SourceEvidence }) {
  return (
    <Frame
      eyebrow="Source at the failing line"
      path={`${source.path}${source.targetLine ? `:${source.targetLine}` : ""}`}
      right={source.url ? <GithubLink url={source.url} /> : undefined}
      truncated={source.truncated}
    >
      <div className="font-mono text-xs leading-relaxed">
        {source.lines.map((line, i) => {
          const isTarget =
            line.number != null && line.number === source.targetLine;
          return (
            <div
              key={i}
              className={cn("flex items-stretch", isTarget && "bg-orange-500/10")}
            >
              <span
                className={cn(
                  "w-12 shrink-0 select-none border-r px-2 py-0.5 text-right tabular-nums text-muted-foreground/70",
                  isTarget &&
                    "border-r-orange-500/50 font-semibold text-orange-600 dark:text-orange-400",
                )}
              >
                {line.number ?? ""}
              </span>
              <span
                className={cn(
                  "whitespace-pre px-3 py-0.5",
                  isTarget ? "font-medium text-foreground" : "text-muted-foreground",
                )}
              >
                {line.text || " "}
              </span>
            </div>
          );
        })}
      </div>
    </Frame>
  );
}

function DiffView({ patch }: { patch: PatchEvidence }) {
  const hasStats = patch.additions != null || patch.deletions != null;
  return (
    <Frame
      eyebrow={`The change that introduced it${patch.prNumber ? ` · PR #${patch.prNumber}` : ""}`}
      path={patch.path}
      right={
        <>
          {hasStats ? (
            <span className="shrink-0 text-[11px] font-medium tabular-nums">
              <span className="text-emerald-600 dark:text-emerald-400">
                +{patch.additions ?? 0}
              </span>{" "}
              <span className="text-red-600 dark:text-red-400">
                −{patch.deletions ?? 0}
              </span>
            </span>
          ) : null}
          {patch.url ? <GithubLink url={patch.url} /> : null}
        </>
      }
      truncated={patch.truncated}
    >
      <div className="font-mono text-xs leading-relaxed">
        {patch.rows.map((row, i) => (
          <DiffLine key={i} row={row} />
        ))}
      </div>
    </Frame>
  );
}

function DiffLine({ row }: { row: DiffRow }) {
  if (row.kind === "hunk") {
    return (
      <div className="whitespace-pre bg-muted px-3 py-0.5 text-[11px] text-muted-foreground">
        {row.text}
      </div>
    );
  }
  const sign = row.kind === "add" ? "+" : row.kind === "del" ? "−" : " ";
  return (
    <div
      className={cn(
        "flex items-stretch",
        row.kind === "add" && "bg-emerald-500/10",
        row.kind === "del" && "bg-red-500/10",
      )}
    >
      <span
        className={cn(
          "w-5 shrink-0 select-none py-0.5 text-center",
          row.kind === "add" && "text-emerald-600 dark:text-emerald-400",
          row.kind === "del" && "text-red-600 dark:text-red-400",
          row.kind === "context" && "text-muted-foreground/50",
        )}
      >
        {sign}
      </span>
      <span
        className={cn(
          "whitespace-pre py-0.5 pr-3",
          row.kind === "add" && "text-emerald-700 dark:text-emerald-300",
          row.kind === "del" && "text-red-700 dark:text-red-300",
          row.kind === "context" && "text-muted-foreground",
        )}
      >
        {row.text || " "}
      </span>
    </div>
  );
}

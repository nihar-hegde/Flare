import type { Investigation } from "@/lib/api";

type Step = Investigation["steps"][number];

export interface SourceLine {
  number: number | null;
  text: string;
}

export interface SourceEvidence {
  key: string;
  path: string;
  url: string | null;
  /** The stack-frame line this window was centered on — highlighted in the UI. */
  targetLine: number | null;
  lines: SourceLine[];
  truncated: boolean;
}

export interface DiffRow {
  kind: "hunk" | "add" | "del" | "context";
  text: string;
}

export interface PatchEvidence {
  key: string;
  prNumber: number | null;
  path: string;
  url: string | null;
  additions: number | null;
  deletions: number | null;
  rows: DiffRow[];
  truncated: boolean;
}

export interface CodeEvidence {
  sources: SourceEvidence[];
  patches: PatchEvidence[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object") return value as Record<string, unknown>;
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed && typeof parsed === "object"
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  return null;
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" ? v : null);

/** The source tool returns content pre-formatted as `  12 | code`. Split it back
 *  into line number + text so we can render a gutter and highlight a line. */
function parseSourceLines(content: string): SourceLine[] {
  return content.split("\n").map((raw) => {
    const match = raw.match(/^\s*(\d+)\s\|\s?(.*)$/);
    if (match) return { number: Number(match[1]), text: match[2] ?? "" };
    return { number: null, text: raw };
  });
}

/** Parse a unified diff (GitHub patch) into typed rows. */
function parseDiff(patch: string): DiffRow[] {
  const rows: DiffRow[] = [];
  for (const line of patch.split("\n")) {
    if (
      line.startsWith("diff --git") ||
      line.startsWith("index ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ")
    ) {
      continue;
    }
    if (line.startsWith("@@")) rows.push({ kind: "hunk", text: line });
    else if (line.startsWith("+")) rows.push({ kind: "add", text: line.slice(1) });
    else if (line.startsWith("-")) rows.push({ kind: "del", text: line.slice(1) });
    else rows.push({ kind: "context", text: line.startsWith(" ") ? line.slice(1) : line });
  }
  while (
    rows.length > 0 &&
    rows[rows.length - 1]?.kind === "context" &&
    rows[rows.length - 1]?.text === ""
  ) {
    rows.pop();
  }
  return rows;
}

/**
 * Pull the first-class code evidence out of the agent's tool trace: the source
 * window(s) it inspected around the failing stack frame, and the PR patch(es) it
 * read. This is the data behind the "How Flare investigated" trace, surfaced as
 * dedicated UI instead of raw JSON.
 */
export function extractCodeEvidence(steps: Step[]): CodeEvidence {
  const sources: SourceEvidence[] = [];
  const patches: PatchEvidence[] = [];

  steps.forEach((step) => {
    const out = asRecord(step.output);
    if (!out || out.found !== true) return;
    const input = asRecord(step.input);

    if (step.tool === "get_stack_frame_source") {
      const content = str(out.content);
      if (!content) return;
      sources.push({
        key: `src-${step.index}`,
        path: str(out.path) ?? str(out.filename) ?? "source",
        url: str(out.url),
        targetLine: num(input?.line),
        lines: parseSourceLines(content),
        truncated: out.truncated === true,
      });
    }

    if (step.tool === "get_pr_file_patch") {
      const patch = str(out.patch);
      if (!patch) return;
      patches.push({
        key: `patch-${step.index}`,
        prNumber: num(out.number),
        path: str(out.path) ?? str(out.filename) ?? "file",
        url: str(out.url),
        additions: num(out.additions),
        deletions: num(out.deletions),
        rows: parseDiff(patch),
        truncated: out.truncated === true,
      });
    }
  });

  return { sources, patches };
}

export function hasCodeEvidence(steps: Step[]): boolean {
  const { sources, patches } = extractCodeEvidence(steps);
  return sources.length > 0 || patches.length > 0;
}

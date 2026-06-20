"use client";

import {
  Bot,
  Check,
  Copy,
  ExternalLink,
  FileText,
  GitPullRequest,
  MessageSquare,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FixHandoff as FixHandoffModel, HandoffArtifact } from "@/lib/fix-handoff";
import { cn } from "@/lib/utils";
import {
  OpenFixPrButton,
  type FixPrState,
} from "@/components/open-fix-pr-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function FixHandoff({
  handoff,
  incidentId,
  initialPr = null,
}: {
  handoff: FixHandoffModel;
  incidentId: string;
  initialPr?: FixPrState | null;
}) {
  const [selectedKind, setSelectedKind] = useState(
    handoff.artifacts[0]?.kind ?? "agent_prompt",
  );
  const [copiedKind, setCopiedKind] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selected =
    handoff.artifacts.find((artifact) => artifact.kind === selectedKind) ??
    handoff.artifacts[0];
  const stats = useMemo(
    () => (selected ? artifactStats(selected.body) : null),
    [selected],
  );

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  async function onCopy(artifact: HandoffArtifact) {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    try {
      await copyToClipboard(artifact.body);
      setCopiedKind(artifact.kind);
      setFailed(false);
      timeoutRef.current = setTimeout(() => setCopiedKind(null), 1800);
    } catch {
      setCopiedKind(null);
      setFailed(true);
    }
  }

  if (!selected) return null;

  return (
    <div className="min-w-0 space-y-5">
      <div className="grid gap-x-6 gap-y-4 border-b pb-4 md:grid-cols-2">
        <Signal
          label="Root cause"
          value={handoff.headline}
          detail={
            handoff.confidence == null ? null : `${handoff.confidence}% confidence`
          }
        />
        <Signal
          label="Primary fix"
          value={handoff.primaryFix?.title ?? "No fix suggested"}
          detail={handoff.primaryFix?.detail ?? null}
        />
        <Signal
          label="Likely suspect"
          value={handoff.suspect?.label ?? "No suspect ranked"}
          detail={
            handoff.suspect
              ? `${handoff.suspect.likelihood}% likelihood`
              : null
          }
          href={handoff.suspect?.url ?? null}
        />
        <Signal
          label="Handoff"
          value={`${handoff.artifacts.length} ready-to-copy artifacts`}
          detail="Agent prompt, issue, PR comment, Slack update, and PR description"
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,22rem)]">
        <div className="min-w-0">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Proof
          </h3>
          <ul className="mt-2 space-y-2">
            {handoff.proof.slice(0, 4).map((item, index) => (
              <li key={index} className="flex min-w-0 gap-2.5 text-sm">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-orange-500" />
                <span className="min-w-0 break-words leading-relaxed text-muted-foreground">
                  {item}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="min-w-0 border-t pt-4 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Validate the fix
          </h3>
          <ul className="mt-2 space-y-2">
            {handoff.validation.slice(0, 4).map((item, index) => (
              <li key={index} className="flex min-w-0 gap-2.5 text-sm">
                <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-500" />
                <span className="min-w-0 break-words leading-relaxed text-muted-foreground">
                  {item}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {handoff.recommendedOwnerFiles.length || handoff.remainingRisk.length ? (
        <div className="grid gap-5 border-t pt-4 md:grid-cols-2">
          {handoff.recommendedOwnerFiles.length ? (
            <DetailList
              title="Owner files"
              items={handoff.recommendedOwnerFiles}
            />
          ) : null}
          {handoff.remainingRisk.length ? (
            <DetailList title="Remaining risk" items={handoff.remainingRisk} />
          ) : null}
        </div>
      ) : null}

      <div className="border-t pt-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Ready to send
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {selected.description}
            </p>
          </div>
          <div className="flex flex-wrap items-start gap-2 self-start sm:self-auto">
            <OpenFixPrButton incidentId={incidentId} initialPr={initialPr} />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onCopy(selected)}
              title={`Copy ${selected.title}`}
            >
              {copiedKind === selected.kind ? (
                <>
                  <Check className="text-emerald-500" />
                  Copied
                </>
              ) : (
                <>
                  <Copy />
                  Copy {selected.title}
                </>
              )}
            </Button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {handoff.artifacts.map((artifact) => {
            const active = artifact.kind === selected.kind;
            const Icon = artifactIcon[artifact.kind] ?? FileText;
            return (
              <Button
                key={artifact.kind}
                type="button"
                variant={active ? "secondary" : "outline"}
                size="sm"
                onClick={() => setSelectedKind(artifact.kind)}
                className={cn("gap-1.5", active && "ring-1 ring-foreground/10")}
              >
                <Icon className="size-3.5" />
                {artifact.title}
              </Button>
            );
          })}
        </div>

        <div className="mt-3 min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge className="bg-muted text-muted-foreground">
              {stats?.lines ?? 0} lines
            </Badge>
            <Badge className="bg-muted text-muted-foreground">
              {stats?.characters ?? "0"} chars
            </Badge>
          </div>
          <pre className="max-h-80 overflow-auto rounded-lg border bg-muted/40 p-3 text-xs leading-relaxed">
            <code className="whitespace-pre-wrap break-words">
              {selected.body}
            </code>
          </pre>
        </div>

        {failed ? (
          <p className="mt-2 text-xs text-destructive">
            Copy failed. Select the artifact text and copy manually.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function DetailList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="min-w-0">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <ul className="mt-2 flex flex-wrap gap-2">
        {items.slice(0, 6).map((item, index) => (
          <li
            key={`${item}:${index}`}
            className="max-w-full rounded-md border bg-muted/35 px-2 py-1 text-xs text-muted-foreground"
          >
            <span className="block truncate">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Signal({
  label,
  value,
  detail,
  href,
}: {
  label: string;
  value: string;
  detail?: string | null;
  href?: string | null;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="mt-0.5 inline-flex max-w-full items-center gap-1 text-sm font-semibold hover:underline"
        >
          <span className="min-w-0 truncate">{value}</span>
          <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
        </a>
      ) : (
        <div className="mt-0.5 break-words text-sm font-semibold leading-snug">
          {value}
        </div>
      )}
      {detail ? (
        <div className="mt-1 break-words text-xs leading-relaxed text-muted-foreground">
          {detail}
        </div>
      ) : null}
    </div>
  );
}

const artifactIcon: Partial<
  Record<HandoffArtifact["kind"], typeof FileText>
> = {
  agent_prompt: Bot,
  github_issue: FileText,
  pr_comment: GitPullRequest,
  slack_update: MessageSquare,
  pr_description: FileText,
};

function artifactStats(body: string): { lines: number; characters: string } {
  return {
    lines: body.split("\n").length,
    characters: body.length.toLocaleString("en-US"),
  };
}

async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }

  fallbackCopy(text);
}

function fallbackCopy(text: string): void {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    const ok = document.execCommand("copy");
    if (!ok) throw new Error("Copy command failed");
  } finally {
    document.body.removeChild(textarea);
  }
}

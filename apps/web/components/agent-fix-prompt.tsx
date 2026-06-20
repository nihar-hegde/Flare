"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

export function AgentFixPrompt({ prompt }: { prompt: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stats = useMemo(() => promptStats(prompt), [prompt]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  async function onCopy() {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    try {
      await copyToClipboard(prompt);
      setCopied(true);
      setFailed(false);
      timeoutRef.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
      setFailed(true);
    }
  }

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">
          {stats.lines} lines · {stats.characters} characters
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onCopy}
          title="Copy agent prompt"
          className="self-start sm:self-auto"
        >
          {copied ? (
            <>
              <Check className="text-emerald-500" />
              Copied
            </>
          ) : (
            <>
              <Copy />
              Copy prompt
            </>
          )}
        </Button>
      </div>

      <pre className="max-h-96 overflow-auto rounded-lg border bg-muted/40 p-3 text-xs leading-relaxed">
        <code className="whitespace-pre-wrap break-words">{prompt}</code>
      </pre>

      {failed ? (
        <p className="text-xs text-destructive">
          Copy failed. Select the prompt text and copy manually.
        </p>
      ) : null}
    </div>
  );
}

function promptStats(prompt: string): { lines: number; characters: string } {
  return {
    lines: prompt.split("\n").length,
    characters: prompt.length.toLocaleString("en-US"),
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

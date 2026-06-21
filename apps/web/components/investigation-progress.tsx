"use client";

import { Check, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { fetchIncident } from "@/lib/api";
import { cn } from "@/lib/utils";

/** The real stages of a Flare investigation, in order. */
const PHASES = [
  "Reading the stack trace",
  "Correlating recent merges & deploys",
  "Fetching source at the failing line",
  "Inspecting the suspect PR diff",
  "Writing the root-cause report",
];

const PHASE_INTERVAL_MS = 7000;
const POLL_INTERVAL_MS = 4000;

function isRunning(status: string | null): boolean {
  return status === "running" || status === "pending";
}

/**
 * Live, animated progress while the agent works — so the ~minute-long run reads
 * as "Flare is thinking" instead of a dead spinner. Advances through the real
 * investigation phases on a timer and polls for completion, then refreshes the
 * server component to swap in the finished report.
 */
export function InvestigationProgress({
  incidentId,
  status,
}: {
  incidentId: string;
  status: string | null;
}) {
  const router = useRouter();
  const [active, setActive] = useState(0);
  const activeRef = useRef(active);
  const running = isRunning(status);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      setActive((current) => Math.min(current + 1, PHASES.length - 1));
    }, PHASE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [running]);

  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    const id = setInterval(async () => {
      try {
        const incident = await fetchIncident(incidentId);
        const next = incident?.investigation?.status ?? null;
        if (!cancelled && next && !isRunning(next)) router.refresh();
      } catch {
        // The server-rendered page can still see the API even when a browser
        // poll misses a response, so keep nudging the route toward fresh data.
        if (!cancelled) router.refresh();
      }

      if (!cancelled && activeRef.current === PHASES.length - 1) {
        router.refresh();
      }
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [running, incidentId, router]);

  if (!running) return null;

  return (
    <div>
      <div className="flex items-center gap-2 text-sm font-medium">
        <Loader2 className="size-4 animate-spin text-orange-500" />
        Flare is investigating…
      </div>
      <ol className="mt-4 space-y-2.5">
        {PHASES.map((label, i) => {
          const state =
            i < active ? "done" : i === active ? "active" : "pending";
          return (
            <li key={label} className="flex items-center gap-2.5 text-sm">
              <span className="grid size-4 shrink-0 place-items-center">
                {state === "done" ? (
                  <Check className="size-4 text-emerald-500" />
                ) : state === "active" ? (
                  <Loader2 className="size-4 animate-spin text-orange-500" />
                ) : (
                  <span className="size-1.5 rounded-full bg-muted-foreground/30" />
                )}
              </span>
              <span
                className={cn(
                  "leading-relaxed",
                  state === "pending" && "text-muted-foreground/50",
                  state === "active" && "font-medium text-foreground",
                  state === "done" && "text-muted-foreground",
                )}
              >
                {label}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

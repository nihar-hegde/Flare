"use client";

import { Loader2, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";

const POLL_INTERVAL_MS = 2500;
const POLL_TIMEOUT_MS = 120_000;

/**
 * Triggers an AI investigation for an incident and keeps the page in sync while
 * it runs. The API fast-acks, so we poll the detail endpoint until the
 * investigation leaves the `running` state, then refresh the server component.
 */
export function InvestigateButton({
  incidentId,
  status,
}: {
  incidentId: string;
  status: string | null;
}) {
  const router = useRouter();
  const [running, setRunning] = useState(status === "running");
  const startedAt = useRef<number>(0);

  useEffect(() => {
    if (!running) return;
    if (startedAt.current === 0) startedAt.current = Date.now();

    const interval = setInterval(async () => {
      if (Date.now() - startedAt.current > POLL_TIMEOUT_MS) {
        setRunning(false);
        router.refresh();
        return;
      }
      try {
        const res = await api.api.incidents[":id"].$get(
          { param: { id: incidentId } },
          { init: { cache: "no-store" } },
        );
        if (!res.ok) return;
        const body = await res.json();
        const current = body.data.investigation?.status;
        if (current && current !== "running") {
          setRunning(false);
          router.refresh();
        }
      } catch {
        // Transient error — keep polling until the timeout.
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [running, incidentId, router]);

  const onClick = useCallback(async () => {
    setRunning(true);
    startedAt.current = Date.now();
    try {
      await api.api.incidents[":id"].investigate.$post({
        param: { id: incidentId },
      });
      router.refresh();
    } catch {
      setRunning(false);
    }
  }, [incidentId, router]);

  return (
    <Button onClick={onClick} disabled={running} variant="outline" size="sm">
      {running ? (
        <>
          <Loader2 className="animate-spin" />
          Investigating…
        </>
      ) : (
        <>
          <Sparkles />
          {status ? "Re-investigate" : "Investigate"}
        </>
      )}
    </Button>
  );
}

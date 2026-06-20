"use client";

import { Loader2, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";

function isRunning(status: string | null): boolean {
  return status === "running" || status === "pending";
}

/**
 * Triggers an AI investigation for an incident. The progress panel owns polling
 * while the background run is active; this button only reflects current status.
 */
export function InvestigateButton({
  incidentId,
  status,
}: {
  incidentId: string;
  status: string | null;
}) {
  const router = useRouter();
  const [optimisticRunning, setOptimisticRunning] = useState(false);
  const running = isRunning(status) || optimisticRunning;

  const onClick = useCallback(async () => {
    setOptimisticRunning(true);
    try {
      await api.api.incidents[":id"].investigate.$post({
        param: { id: incidentId },
      });
      router.refresh();
    } catch {
      setOptimisticRunning(false);
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

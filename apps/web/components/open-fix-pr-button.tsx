"use client";

import { ExternalLink, GitPullRequest, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { api, fetchIncident } from "@/lib/api";
import { Button } from "@/components/ui/button";

export interface FixPrState {
  url: string | null;
  number: number | null;
  draft: boolean;
  applied: boolean;
}

/**
 * Closes the loop on an investigation: opens a (draft) fix PR in the connected
 * repo from the handoff. On success — or when one already exists for this
 * investigation (passed as initialPr) — it shows a link straight to the PR.
 */
export function OpenFixPrButton({
  incidentId,
  initialPr = null,
}: {
  incidentId: string;
  initialPr?: FixPrState | null;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<FixPrState | null>(initialPr);
  const [error, setError] = useState<string | null>(null);

  const onClick = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.api.incidents[":id"]["fix-pr"].$post({
        param: { id: incidentId },
      });
      const body = (await res.json()) as
        | { data: FixPrState }
        | { error?: string };

      if (!res.ok || !("data" in body)) {
        throw new Error(
          ("error" in body && body.error) || "Failed to open fix PR.",
        );
      }

      setResult(body.data);
      router.refresh();
    } catch (err) {
      const recovered = await recoverCreatedPr(incidentId);
      if (recovered) {
        setResult(recovered);
        setError(null);
        router.refresh();
      } else {
        setError(err instanceof Error ? err.message : "Failed to open fix PR.");
      }
    } finally {
      setLoading(false);
    }
  }, [incidentId, router]);

  if (result) {
    const label = result.applied ? "View fix PR" : "View fix plan PR";
    if (!result.url) {
      return (
        <p className="text-xs text-muted-foreground">
          Fix PR created{result.number ? ` (#${result.number})` : ""}.
        </p>
      );
    }
    return (
      <Button asChild size="sm" variant="secondary">
        <a href={result.url} target="_blank" rel="noreferrer">
          <GitPullRequest />
          {label}
          {result.number ? ` #${result.number}` : ""}
          <ExternalLink className="size-3 text-muted-foreground" />
        </a>
      </Button>
    );
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Button type="button" size="sm" onClick={onClick} disabled={loading}>
        {loading ? (
          <>
            <Loader2 className="animate-spin" />
            Generating fix…
          </>
        ) : (
          <>
            <GitPullRequest />
            Open draft fix PR
          </>
        )}
      </Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

async function recoverCreatedPr(
  incidentId: string,
): Promise<FixPrState | null> {
  try {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const incident = await fetchIncident(incidentId);
    return incident?.investigation?.fixPr ?? null;
  } catch {
    return null;
  }
}

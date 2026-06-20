import { fetchIncidents, type IncidentListItem } from "@/lib/api";
import { IncidentCard } from "@/components/incident-card";
import { RealtimeRefresher } from "@/components/realtime-refresher";
import { SiteHeader } from "@/components/site-header";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  let incidents: IncidentListItem[] = [];
  let error: string | null = null;

  try {
    incidents = await fetchIncidents();
  } catch {
    error = "Could not reach the Flare API. Is the api server running?";
  }

  const active = incidents.filter((i) => i.status !== "resolved");
  const resolved = incidents.filter((i) => i.status === "resolved");

  return (
    <>
      <SiteHeader />
      <RealtimeRefresher />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight">Incidents</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Errors detected in production, with AI root-cause analysis.
          </p>
        </div>

        {error ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </div>
        ) : incidents.length === 0 ? (
          <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
            No incidents yet.
          </div>
        ) : (
          <div className="space-y-8">
            <IncidentGroup label="Active" incidents={active} />
            {resolved.length > 0 ? (
              <IncidentGroup label="Resolved" incidents={resolved} />
            ) : null}
          </div>
        )}
      </main>
    </>
  );
}

function IncidentGroup({
  label,
  incidents,
}: {
  label: string;
  incidents: IncidentListItem[];
}) {
  if (incidents.length === 0) return null;
  return (
    <div>
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label} · {incidents.length}
      </h2>
      <div className="grid gap-3">
        {incidents.map((incident) => (
          <IncidentCard key={incident.id} incident={incident} />
        ))}
      </div>
    </div>
  );
}

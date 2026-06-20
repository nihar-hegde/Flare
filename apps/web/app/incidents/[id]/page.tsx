import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchIncident } from "@/lib/api";
import { hasCodeEvidence } from "@/lib/evidence";
import { formatNumber, timeAgo } from "@/lib/format";
import { AgentTrace } from "@/components/agent-trace";
import { SeverityBadge, StatusBadge } from "@/components/badges";
import { CodeEvidence } from "@/components/code-evidence";
import { Meter } from "@/components/confidence-meter";
import { EvidencePanel } from "@/components/evidence-panel";
import { InvestigateButton } from "@/components/investigate-button";
import { RealtimeRefresher } from "@/components/realtime-refresher";
import { Section } from "@/components/section";
import { SiteHeader } from "@/components/site-header";
import { StackTrace } from "@/components/stack-trace";
import { SuggestedFixes } from "@/components/suggested-fixes";
import { SuspectList } from "@/components/suspect-list";
import { Timeline } from "@/components/timeline";

export const dynamic = "force-dynamic";

export default async function IncidentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const incident = await fetchIncident(id);

  if (!incident) {
    notFound();
  }

  const investigation = incident.investigation;

  return (
    <>
      <SiteHeader />
      <RealtimeRefresher />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">
        <Link
          href="/"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← All incidents
        </Link>

        <div className="mt-4 flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 max-w-5xl">
            <div className="flex items-center gap-2">
              <SeverityBadge severity={incident.severity} />
              <StatusBadge status={incident.status} />
            </div>
            <h1 className="mt-3 break-words text-3xl font-bold leading-tight tracking-tight">
              {incident.title}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {incident.service ?? "unknown service"}
              {incident.environment ? ` · ${incident.environment}` : ""}
              {incident.releaseVersion ? ` · ${incident.releaseVersion}` : ""}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-start gap-3 lg:items-end">
            <dl className="grid grid-cols-3 gap-5 text-left lg:text-right">
              <Stat
                label="Events"
                value={formatNumber(incident.occurrenceCount)}
              />
              <Stat label="Users" value={formatNumber(incident.affectedUsers)} />
              <Stat label="First seen" value={timeAgo(incident.firstSeenAt)} />
            </dl>
            <InvestigateButton
              incidentId={incident.id}
              status={investigation?.status ?? null}
            />
          </div>
        </div>

        <div className="mt-8 grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,24rem)]">
          <div className="min-w-0 space-y-6">
            <Section
              title="Root cause"
              action={
                investigation?.confidence != null
                  ? `${investigation.confidence}% confidence`
                  : null
              }
            >
              {!investigation ? (
                <p className="text-sm text-muted-foreground italic">
                  No investigation has run for this incident yet.
                </p>
              ) : investigation.status === "running" ||
                investigation.status === "pending" ? (
                <p className="text-sm text-muted-foreground italic">
                  Flare is investigating this incident…
                </p>
              ) : investigation.status === "failed" ? (
                <p className="text-sm text-destructive">
                  Investigation failed. Try running it again.
                </p>
              ) : (
                <div className="space-y-4">
                  {investigation.confidence != null ? (
                    <Meter value={investigation.confidence} />
                  ) : null}
                  {investigation.rootCause ? (
                    <p className="text-sm font-medium">
                      {investigation.rootCause}
                    </p>
                  ) : null}
                  {investigation.reasoning ? (
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      {investigation.reasoning}
                    </p>
                  ) : null}
                </div>
              )}
            </Section>

            <Section title="Change correlation">
              <SuspectList suspects={incident.suspects} />
            </Section>

            {investigation?.status === "complete" ? (
              <>
                {hasCodeEvidence(investigation.steps) ? (
                  <Section title="Code evidence">
                    <CodeEvidence steps={investigation.steps} />
                  </Section>
                ) : null}
                <Section title="Suggested fixes">
                  <SuggestedFixes fixes={investigation.suggestedFixes} />
                </Section>
                <Section title="Evidence">
                  <EvidencePanel evidence={investigation.evidence} />
                </Section>
                <Section title="How Flare investigated">
                  <AgentTrace steps={investigation.steps} />
                </Section>
              </>
            ) : null}
          </div>

          <div className="min-w-0 space-y-6">
            <Section title="Error">
              <dl className="space-y-2 text-sm">
                <Field label="Type" value={incident.errorType} mono />
                <Field label="Message" value={incident.errorMessage} />
                <Field label="Culprit" value={incident.culprit} mono />
                {incident.permalink ? (
                  <div>
                    <dt className="text-xs text-muted-foreground">Source</dt>
                    <dd>
                      <a
                        href={incident.permalink}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-sm text-orange-600 hover:underline dark:text-orange-400"
                      >
                        View source event
                        <ExternalLink className="size-3" />
                      </a>
                    </dd>
                  </div>
                ) : null}
              </dl>
            </Section>

            <Section title="Stack trace">
              <StackTrace frames={incident.latestEvent?.stackTrace ?? []} />
            </Section>

            <Section title="Timeline">
              <Timeline entries={incident.timeline} />
            </Section>
          </div>
        </div>
      </main>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="text-sm font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | null;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={
          mono
            ? "break-all font-mono text-xs leading-relaxed"
            : "break-words text-sm leading-relaxed"
        }
      >
        {value ?? "—"}
      </dd>
    </div>
  );
}

export function EvidencePanel({ evidence }: { evidence: string[] }) {
  if (evidence.length === 0) {
    return (
      <p className="text-sm text-muted-foreground italic">
        No evidence recorded.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {evidence.map((item, i) => (
        <li key={i} className="flex gap-2.5 text-sm">
          <span
            aria-hidden
            className="mt-1.5 size-1.5 shrink-0 rounded-full bg-orange-500"
          />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

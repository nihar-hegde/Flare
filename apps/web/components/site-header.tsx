import { Flame } from "lucide-react";
import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2">
          <span className="grid size-7 place-items-center rounded-lg bg-orange-500 text-white">
            <Flame className="size-4" />
          </span>
          <span className="text-base font-semibold tracking-tight">Flare</span>
          <span className="hidden text-xs text-muted-foreground sm:inline">
            AI Incident Investigator
          </span>
        </Link>
      </div>
    </header>
  );
}

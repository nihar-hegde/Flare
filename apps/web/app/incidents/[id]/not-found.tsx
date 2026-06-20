import Link from "next/link";
import { SiteHeader } from "@/components/site-header";

export default function IncidentNotFound() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center px-4 py-20 text-center">
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          Incident not found
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          This incident may have been removed or never existed.
        </p>
        <Link
          href="/"
          className="mt-4 text-sm text-orange-600 hover:underline dark:text-orange-400"
        >
          ← Back to all incidents
        </Link>
      </main>
    </>
  );
}

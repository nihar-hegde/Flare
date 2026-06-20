"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

/**
 * Subscribes to Postgres changes on incidents/investigations and refreshes the
 * server-rendered data when something changes. No-ops if Supabase Realtime env
 * vars are absent, so the dashboard works fine without it.
 */
export function RealtimeRefresher() {
  const router = useRouter();

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    const channel = supabase
      .channel("flare-dashboard")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "incidents" },
        () => router.refresh(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "investigations" },
        () => router.refresh(),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [router]);

  return null;
}

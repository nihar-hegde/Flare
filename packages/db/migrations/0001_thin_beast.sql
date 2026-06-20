-- Collapse pre-existing duplicate ACTIVE incidents created by the old fingerprint
-- bug (where trailing ids like `txn_test_312` were not normalized, so each one
-- spawned its own incident). Without this, the unique index below cannot be
-- created. Keep the most-recently-seen active incident per (org, fingerprint);
-- mark the rest resolved so they drop out of the partial index.
UPDATE "incidents" AS dup
SET "status" = 'resolved',
    "resolved_at" = now(),
    "resolution" = 'Auto-merged duplicate during fingerprint dedupe migration'
WHERE dup."status" NOT IN ('resolved', 'ignored')
  AND dup."fingerprint" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "incidents" AS keep
    WHERE keep."organization_id" = dup."organization_id"
      AND keep."fingerprint" = dup."fingerprint"
      AND keep."status" NOT IN ('resolved', 'ignored')
      AND (
        keep."last_seen_at" > dup."last_seen_at"
        OR (keep."last_seen_at" = dup."last_seen_at" AND keep."id" > dup."id")
      )
  );
--> statement-breakpoint
CREATE UNIQUE INDEX "incidents_active_fingerprint_idx" ON "incidents" USING btree ("organization_id","fingerprint") WHERE "incidents"."status" not in ('resolved', 'ignored');

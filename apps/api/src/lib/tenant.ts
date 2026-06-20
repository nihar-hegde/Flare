// Single hardcoded workspace until Supabase Auth is wired up.
// Must match the organization seeded in packages/db/src/seed.ts.
//
// When auth lands, replace reads of CURRENT_ORG_ID with the org resolved from
// the authenticated session (e.g. via middleware writing it onto the context).
export const CURRENT_ORG_ID = "00000000-0000-0000-0000-000000000001";

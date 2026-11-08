# Supabase public-schema RLS review backlog

**Status:** NOT REMEDIATED — separate, table-by-table security review required.

On 2026-11-08, the Supabase catalog/advisory reported 25 existing `public` tables with RLS disabled. This follow-up did not inspect or change their access policies. A targeted check on the newly hardened administrator email-change authorization table found no table-level privileges for `anon`, `authenticated`, or `PUBLIC`; it does not establish the exposure status of the other 25 tables.

Track a separate review that inventories each table's schema exposure, table and column ACLs, inherited role memberships, views/functions, required API access, and expected RLS policies before changing permissions. Do not apply blanket `ENABLE ROW LEVEL SECURITY` statements without a per-table policy and application-compatibility plan.

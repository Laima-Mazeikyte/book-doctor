# Read-only live schema inventory

1. Copy the complete contents of [export-live-schema.sql](export-live-schema.sql) into the Supabase SQL Editor for the project being reviewed.
2. Run it as the usual `postgres` SQL Editor role so the metadata is visible.
3. Export the result as JSON. The result has one row with a `schema_export` object; exporting the whole row is fine.
4. Save it as `temp/live-schema-export.json` in this repository. That directory is ignored by Git. Definitions and webhook arguments must be reviewed for embedded credentials before anything is committed.

The script is a single SELECT over PostgreSQL's catalogs. It does not execute the functions or triggers whose definitions it reads, read application rows, or update migration tracking. It was verified on PostgreSQL 17 inside a read-only transaction against an empty database and a disposable schema containing functions, triggers, policies, grants, generated/identity columns, partitions, and custom types.

The output inventories application schemas, excluding extension-owned definitions and the listed Supabase-managed schemas. It includes non-internal triggers and policies attached to `auth` and `storage` for review. Those attachments may include Supabase-managed objects; they must be classified before generating migrations.

`counts` reports how many objects were captured in each section. `objects_needing_separate_definition` identifies several uncommon object kinds that need further inspection. The output is a schema inventory, not a directly executable restore script or an exhaustive substitute for `pg_dump`.

The export excludes application/user rows, current sequence values, cron job commands, migration-history rows, storage bucket rows, and Dashboard/Auth/API configuration. Cron and migration-history table presence is reported. We already collected migration-history versions separately; any further metadata or job-configuration reads can be scoped after reviewing the result.

PostgreSQL documents the definition extraction functions in [System Information Functions and Operators](https://www.postgresql.org/docs/17/functions-info.html).

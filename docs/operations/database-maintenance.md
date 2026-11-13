# Database maintenance

Maintenance is explicit and independent of application builds. Never run operational
SQL merely because it is present in the repository. Read the individual script's
scope/prerequisites and inspect current state before repeating an operation.

## Completed shared-project work

User-reported catalog compaction completed October 30, 2026 at 01:19:20 UTC (October
29 Chicago time). Books including indexes fell from 261,160,960 to 130,170,880 bytes,
reclaiming 130,990,080 bytes. Later verification found no rewrite or worker/observer
jobs, intact slugs/annotations/series and valid indexes. Do not rerun that completed
maintenance to start development. Empty import staging was separately reclaimed.

The October 30 inventory reported 354.0 MiB for postgres and 368.6 MiB across databases
including templates, below the then-reviewed allowance. These are historical allocations,
not live disk-free measurements or a current billing promise. Connections added a
separate 16 MB active dataset on October 31. Inspect fresh metadata when needed.

## Reusable SQL under scripts/maintenance/

| Purpose                                      | Files                                                          |
| -------------------------------------------- | -------------------------------------------------------------- |
| Allocation inventory                         | supabase-storage-inventory.sql, inspect-book-catalog-space.sql |
| Science hosting and v4 capacity planning     | inspect-science-hosting.sql                                    |
| Author data ownership/retention review       | inspect-author-data-retention.sql                              |
| Reclaim verified empty import storage        | reclaim-book-annotation-staging.sql                            |
| Retire confirmed-unused regenerable map data | reclaim-unused-author-map-data.sql                             |
| Explicit compaction, foreground alternative  | compact-book-catalog.sql                                       |
| Scheduled native compaction and observer     | compact-book-catalog-background.sql                            |
| Current maintenance state                    | book-catalog-maintenance-status.sql                            |
| Scheduled attempt/audit/Cron state           | book-catalog-compaction-background-status.sql                  |

The empty-staging script refuses residual staged rows/importer activity. Retention
cleanup is limited to the documented regenerable map exports; raw author comparisons,
source datasets, application tables and active releases are not blanket cleanup targets.
Use the retention inventory and review consumers before executing it again.

For hosting decisions, paste all of
[inspect-science-hosting.sql](../../scripts/maintenance/inspect-science-hosting.sql)
into Supabase Dashboard **SQL Editor**, with database and role **postgres**. Run it
and copy/export the single `science_hosting_report` JSON cell. It is a read-only
query returning allocation by group, table and index, separate Storage bucket
payload totals, routine reference hints and illustrative v4 growth scenarios.
It does not require the optional science tables to be installed; standard Supabase
Storage metadata tables must exist. No reader records or object paths are returned.

Start with `summary`, then `groups` and `application_and_science_tables` to identify
the dominant allocations and their hosting implications. Check
`storage_buckets_separate_quota` independently: moving file payloads does not remove
imported PostgreSQL rows. `v4_planning_scenarios` compares replacement allocation
with keeping a new copy alongside the existing data. These are sensitivity estimates,
not a measured v4 build or an import-disk guarantee. Edit `settings` for the intended
growth factor and budget; the default 500,000,000 bytes is a conservative planning
input, not a subscription lookup. Pair data need not grow linearly with books.

Compaction is a physical rewrite with an exclusive lock: it can block book reads/writes.
Use a quiet maintenance window and verify physical disk headroom for old/new files,
indexes and WAL. Database allowance is not available disk space. Foreground and
scheduled variants are alternatives; never run both. SKIP_LOCKED can report success
without rewriting a busy table, so verify actual savings. A Dashboard timeout is not
proof the server stopped. Inspect status before retrying or scheduling another job.

Scheduled compaction uses native Cron execution plus an observer. Native success may
precede the audit becoming terminal; remaining jobs, active rewrite, audit state and
recorded savings all matter. Do not remove an active worker early just to tidy Cron.
After a confirmed rewrite, rerun catalog annotation/series/URL verification.

## Schema inventory and baseline promotion

scripts/diagnostics/export-live-schema.sql and export-live-schedules.sql are read-only
inventory tools. Their output can include definitions/webhook arguments and must stay
in ignored local storage after credential review. See the versioned
[schema export instructions](../../scripts/diagnostics/export-live-schema.md).
Inventory is not executable restore SQL and does not replace migration-history
reconciliation or Dashboard/Auth setup.

The optional supabase/baseline/ directory and its review/promotion notes are local-only
candidates excluded by this checkout's .git/info/exclude. They are deliberately not
included in Git and will not exist in a fresh checkout. Publishing or applying a full
production baseline requires separate review; these notes are not an instruction to
unignore or execute that candidate.

The annotation database test instead loads the versioned
[legacy read-RPC fixture](../../scripts/fixtures/legacy-book-read-rpcs.sql) after
creating synthetic tables, identities and RLS. It contains four function definitions,
not application data or a full production baseline. Keep that independent pre-change
snapshot stable so migration-preservation assertions remain meaningful.

No live maintenance, migration replay, permission changes or database deletion is
part of repository cleanup. The retained maintenance tests use disposable local Docker
databases, including native Cron where specifically documented by the test.

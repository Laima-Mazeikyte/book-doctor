# Diagnostic and operational tooling

Start with [development/testing](../../docs/development.md) and
[performance procedures](../../docs/performance.md).

- [Catalog publication](../../docs/operations/catalog.md): scripts/catalog/
- [Connections](../../docs/operations/connections.md): scripts/connections/
- [Sitemaps](../../docs/operations/sitemaps.md): scripts/sitemaps.mjs and scripts/sitemaps/release.json
- [Database maintenance](../../docs/operations/database-maintenance.md): scripts/maintenance/
- [Book-page behavior and pending features](../../docs/book-page.md)
- [Backend annotation contract](../../docs/backend/book-annotations.md)
- [Book-discovery catalog schema export](../catalog/export-book-discovery-schema.sql):
  columns, indexes, SELECT policies, table grants and effective API read access;
  one read-only metadata query; share its `schema_sql` result with backend.
- [Book-discovery installation preflight](../catalog/check-book-discovery-installation.sql):
  read-only admin, catalog-policy and index checks before the Dashboard installer.
- [Book-discovery verification](../catalog/verify-book-discovery.sql):
  explicit supported-book lookup, API-role parity and private-table access checks;
  no cross-transaction session settings.

This folder retains reusable read-only feed/schema/latency diagnostics and browser
probes. SQL intended for Logs Explorer uses a different dialect/source from Database
SQL. Read each script's comments before execution. Shared-project operations are
never part of a normal build.

[Schema export instructions](export-live-schema.md) describe safe local capture.
Keep exported definitions, tokens, delivery data, screenshots and raw reports out
of Git. Superseded notes/evidence and old font formats were archived locally under
temp/repository-cleanup-2026-11-01/ with a checksum manifest; they are not current
run instructions. The under-200-ms rate-entry target remains open.

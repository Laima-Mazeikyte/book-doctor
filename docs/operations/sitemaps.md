# Catalog release sitemaps

Sitemaps are explicit catalog-release snapshots. The current snapshot is labeled
**v3**, using the user's catalog release name. This label is supplied to the export
command; it is not inferred from unrelated author/lab artifact versions or a database
release flag. Source host, capture time, counts and file checksums are recorded in
[sitemap-release.json](../../scripts/sitemaps/release.json).

The generated XML files are checked into `static/` and deployed with the frontend.
Normal builds validate those files offline; builds and crawler requests do not read
Supabase or regenerate the snapshot. No database migration or write is needed.

## Current public files

- `/sitemap.xml`: the stable index address.
- `/sitemap-pages.xml`: homepage and FAQ.
- `/sitemap-books-1.xml`: first 50,000 book addresses.
- `/sitemap-books-2.xml`: next 50,000 book addresses.
- `/sitemap-books-3.xml`: remaining 18,097 book addresses.

The catalog snapshot contains 118,097 unique book URLs. The generator adds/removes
numbered files automatically as needed and enforces both 50,000 entries and
52,428,800 uncompressed bytes per file. The file count can also grow due to the byte
limit. The index references all current files, including the separate public-page
sitemap. `robots.txt` references `https://unread.world/sitemap.xml`.

The only public-page entries currently approved are `/` and `/faq`. Add `/books` or
`/lab` to `PUBLIC_PAGES` in the generator when those public routes are ready, then
regenerate. No account, API, personalized-list, preview-host or error URLs are included.
Book addresses use existing stored slugs with the same encoding as application links.
Optional `lastmod`, `priority` and `changefreq` fields are omitted.

The v3 release passed six generator/validation tests, independent XML parsing of all
five documents, offline checksum/count checks, lint/format checks and the production
build. Built-preview HTTP checks returned 200 with `text/xml` and matching checksums
for all five files; robots returned 200 and an unknown shard returned 404. Production
deployment and the first Search Console submission remain pending.

## Publishing v4

1. Finish publishing v4 to the shared Supabase catalog. Run the export between
   imports, with catalog membership stable. Preserve existing book IDs and stored
   slugs during publication; regenerating sitemaps does not migrate changed addresses.
2. From the `book-doctor` directory, regenerate from the current database:

   ```sh
   pnpm run sitemap:generate --release v4
   ```

   The command uses the public Supabase URL and anonymous key from the existing
   environment (`VITE_*`, falling back to `PUBLIC_*`). Shell environment values take
   precedence over `.env.local` and `.env`. It uses read-only GET requests for
   `book_id,slug`, ordered by the indexed book ID, with keyset pagination.

3. Review the new release manifest and generated XML, then run:

   ```sh
   pnpm run sitemap:check
   pnpm run build
   ```

4. Commit the complete generated file set and manifest with the release, then deploy
   the frontend. Uploading v4 to Supabase alone does not replace Netlify's static XML.
   The public index address stays `/sitemap.xml`; there is no version in its URL.

If v4 retains exactly the same book URLs, the XML can remain byte-for-byte identical;
the release manifest still records the new export. Changes to descriptions or model
scores do not require different address entries.

For the current catalog, regeneration uses `--release v3` instead. Re-running generation
records a fresh capture time; it is an explicit read of the then-current catalog,
not a way to retrieve an old historical release after the database has changed.

## Completeness and deployment checks

Before replacing any XML, generation checks unique IDs and URLs, stored-slug validity,
and ordered pagination. A second complete read must match every ID and slug, and the
highest book ID must remain unchanged. This avoids the shared database's whole-table
count timeout and detects equal-count membership/address changes. These are REST
export checks, not a repeatable-read database transaction. Generate after publication
completes, rather than during an import.

New artifacts are validated and staged locally before replacing the managed files.
The manifest is written last. Offline validation checks checksums, XML structure,
approved origin and paths, duplicate URLs, index references, catalog/page totals and
protocol limits. It also rejects stale unreferenced managed XML files and a missing
robots declaration. An interrupted replacement fails validation instead of deploying
a mixed release. Only filenames belonging to this sitemap system are replaced/removed.

`pnpm run build` runs this check before Vite, and Netlify's build command uses that
script. No Supabase access is needed for the check. Generator tests use fake catalog
responses, including capped pages, reordered/incomplete reads, changed addresses/boundaries, duplicate
addresses and file-size boundaries:

```sh
pnpm run test:sitemaps
```

After the first frontend deployment, check the index and its four child XML files on
`https://unread.world`, verify representative book pages return 200, and submit
`https://unread.world/sitemap.xml` in Google Search Console. An XML entry is a discovery
hint, not an indexing or ranking guarantee. Future versions reuse that same index URL.

References: [Google's sitemap guidance](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap),
[sitemap protocol](https://www.sitemaps.org/protocol.html).

# Backend contract: stored book annotations and series

Current delivery schema is **v2**, installed and exercised with test-002. The backend
owns rankings, award assignment and numeric series order. The frontend imports
validated matching records and reads the stored results. See [catalog operations](../operations/catalog.md).

## Deliverables

Provide two UTF-8 files: `manifest.json` and `books.jsonl`. The latter contains one JSON
object per line and one record per existing catalog `book_id` included in this update.
Use `books.book_id`, the 26-character business ULID, rather than `books.id`, the UUID.

The manifest identifies the export and fixed default ranking sources:

```json
{
	"schema_version": 2,
	"export_version": "book-annotations-v4-example",
	"generated_at_utc": "2026-10-26T04:30:00Z",
	"record_count": 1,
	"books_file": "books.jsonl",
	"ranking_sources": {
		"book": {
			"version": "v9",
			"population_count": 64674,
			"default_weights": {
				"regard": 0.4,
				"reach": 0.3,
				"recognition": 0.3
			}
		},
		"author": {
			"version": "v3",
			"population_count": 11950,
			"default_weights": {
				"regard": 0.35,
				"reach": 0.35,
				"recognition": 0.3
			}
		}
	}
}
```

Use the actual export ID, timestamp, row count, release versions, eligible populations,
and each lab's manifest default weights. Values above describe the currently reviewed
releases; they are not settings to apply to a different release automatically.

## Book record

Pretty-printed below for readability; write each complete record on one JSONL line.
This is an illustrative record, not an award claim about an actual book.

```json
{
	"book_id": "01ARZ3NDEKTSV4RRFFQ69G5FAV",
	"book_ranking": {
		"rank": 4440,
		"band": "top_10_percent",
		"series_title": "Example Series (Example Author)"
	},
	"author_ranking": {
		"rank": 759,
		"band": "top_10_percent"
	},
	"awards": [
		{
			"tier": 1,
			"name": "Example Award",
			"status": "winner",
			"year": 2024
		},
		{
			"tier": 3,
			"name": "Another Award",
			"status": "nominee",
			"year": null
		}
	],
	"series_title": "Example Series (Example Author)",
	"series_number": 7.5
}
```

`book_id`, `book_ranking`, `author_ranking`, `awards`, `series_title`, and
`series_number` must be present on every v2 record.
Explicit JSON null is a value; an omitted required property is an incompatible record.

| Field            | Requirement                                                                                                                             |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `book_ranking`   | Object for a ranked item, or null when no standing is supplied.                                                                         |
| `author_ranking` | Object for the book's exact matched author, or null when no standing is supplied.                                                       |
| `rank`           | Positive, 1-based integer within the corresponding manifest population.                                                                 |
| `band`           | `top_0_1_percent`, `top_1_percent`, `top_5_percent`, `top_10_percent`, or null below those tiers.                                       |
| `series_title`   | Optional book-ranking context for an inherited series standing; string or null.                                                         |
| `awards`         | Complete final array for this book; `[]` means processed with no awards; null means no award data supplied and clears a previous value. |
| Award `tier`     | Integer 1–5; 1 is best.                                                                                                                 |
| Award `name`     | Nonempty display name.                                                                                                                  |
| Award `status`   | Exactly `winner` or `nominee`.                                                                                                          |
| Award `year`     | Integer when known, otherwise null; include the property either way.                                                                    |

Compute the default composite rank once on the backend. Book ranks use the lab's one
combined book/series population. All mapped volumes inherit their series' standing.
Author ranks use the author lab's default blend and exact-name matching. Select the
strongest qualifying band using `rank <= population_count * share`, with shares 0.001,
0.01, 0.05, and 0.1. Ranked items outside Top 10% have `band: null`.

The backend also expands awards across the appropriate series books. Each receiving
book's `awards` array is already final, including awards originally received by other
volumes. Inherited awards display identically to direct awards. Do not require original
recipient fields, attribution text, or frontend inheritance logic. Award deduplication
and assignment are backend guarantees; no additional frontend deduplication is planned.

## Applying an update

- Update matching existing books only. Do not delete books or insert incomplete new
  catalog rows as part of this annotation update.
- Books omitted from the export remain untouched. Some stored books are outdated;
  missing export coverage is expected and does not block or require investigation.
- Exported IDs that do not exist in the current table are not inserted by this update;
  an import summary can count them without making them a catalog-completeness task.
- Explicit null overwrites the previous value for the corresponding exported annotation.
  This applies independently to book standing, author standing, and awards.
- The export only updates these declared annotations. Existing scores, keywords,
  descriptions, titles, authors, and other catalog metadata remain outside this annotation update.
- Title and author must remain populated. Invalid core identity is a data-contract error,
  not a reason to invent "Untitled book", "Unknown author", or silently exclude a book.
- Check the file/schema version, required property types, row count, and book ID uniqueness
  before applying changes. This is import validation, not another award cleaning pipeline.
- A failed read or failed validation must not be translated into an empty import or mass
  clearing. Apply validated updates transactionally without first clearing existing data.
- Store the export/source versions with the publication for review and repeatability.
  Page visits and application-process restarts do not trigger recomputation.

## Storage and delivery

Store the award array on the existing `public.books` row in a JSONB `awards` column.
Book and author standings also remain attached to each book's metadata. The additive
migration must preserve the unchanged production application's existing fields/contracts.
The new standing columns are `books.book_ranking` and `books.author_ranking`, both JSONB.
The importer attaches the corresponding manifest `population_count` and source `version`
to each ranking object. It stores `annotation_export_version` and `annotations_updated_at`
on the book, with the full publication manifest retained in a private audit table.

Return awards with the full book page's ordinary catalog response. Return the appropriate
stored standings and reading-tag data with book, drawer, shortlist, and batched feed
responses, so those views share one mapping and wording. No per-book runtime downloads
of ranking populations, additional award requests, award filters, or award statistics
are part of this transition.

## Current frontend scope

Use available scores/keywords and omit empty optional groups. Data-completeness work is
deferred for testing; intentionally absent political scores remain valid. Invalid optional
entries must not prevent other valid annotations or the book from rendering. Missing
synopsis copy is exactly **No description available.** Missing title/author is an error.

See [book-page behavior](../book-page.md) for awards and ranking presentation.

## Series membership fields

| Field           | Type                | Requirement                                                                                                                                                                                                    |
| --------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `series_title`  | string or null      | Exact canonical series name used for both grouping and display. Use the backend's existing `book_series` value. Preserve author disambiguation such as `Series Name (Author)` wherever the source includes it. |
| `series_number` | JSON number or null | Finite decimal **at least 0.01**, with no arbitrary upper cap. This is the intended reading order as well as the displayed volume number. Preserve decimal values without rounding or converting to integers.  |

Both properties must be present. For a book with a series, supply a nonempty canonical
name and its number. For a book with no assigned series membership, supply explicit
JSON null for both. Do not use empty strings, `NA`, zero, or a missing property to mean
no membership.

The user accepted the publication-year-derived positions in `book-annotations-test-002`
for testing, including their possible collisions with existing positions. This is a
known source-data limitation of that delivery, not confirmation of authoritative
reading order for the full production release. Numbers above 100 are now supported.

`series_title` is the shared identity: the source already disambiguates identical names
with the author. No separate `series_id`, nested `series` object, sort-order field,
display-label field, or repeated full series roster is requested. Every member of a
series must use the same canonical name. If a canonical name changes, include all of
that series' affected books in the update so membership remains grouped together.

The agreed format carries one series membership per book. If the source requires
multiple memberships for a book, identify that before delivery rather than silently
dropping memberships or introducing an unagreed array format.

## Record examples

Illustrative values only. Keep `book_id` as the existing 26-character catalog ULID,
not the database row's UUID. Ranking and award contents follow the existing contract.

A series member:

```json
{
	"book_id": "01ARZ3NDEKTSV4RRFFQ69G5FAV",
	"book_ranking": {
		"rank": 4440,
		"band": "top_10_percent",
		"series_title": "Example Series (Example Author)"
	},
	"author_ranking": {
		"rank": 759,
		"band": "top_10_percent"
	},
	"awards": [],
	"series_title": "Example Series (Example Author)",
	"series_number": 7.5
}
```

A book with no assigned series membership:

```json
{
	"book_id": "01ARZ3NDEKTSV4RRFFQ69G5FAW",
	"book_ranking": null,
	"author_ranking": null,
	"awards": [],
	"series_title": null,
	"series_number": null
}
```

The new top-level `series_title` describes membership independently of rankings. It
must be supplied for series members even when `book_ranking` is null or outside the
display badge tiers. The existing nested `book_ranking.series_title`, if present,
continues to describe inherited ranking context; it is not the membership source.
When both refer to the same series, use the same canonical name.

## Export and update rules

- Include all books represented by the current backend catalog, with one record per
  `book_id`. Existing Supabase books absent from the delivery remain untouched.
- An included book replaces its previous series membership. Explicit null/null clears
  the membership; changing the canonical name or number replaces the old assignment.
- Use the supplied number as reading order. No inference from publication dates,
  renumbering to fill gaps, or frontend chronology calculation is needed.
- Keep distinct catalog books even when they share a series number; `book_id` remains
  the record identity. Series numbers are not globally unique book identifiers.
- Existing ranking calculation, shared book/series population, series badge inheritance,
  author matching and final award assignment remain as agreed. Membership does not
  require a ranking badge. This request does not add or recalculate awards or scores.
- This publication updates matching existing catalog books. Unknown IDs can be counted
  in the import summary; they do not cause new incomplete book rows or catalog deletions.
- No backend Supabase schema changes or direct database writes are requested. Deliver
  the files; the frontend import will organize the shared series names and memberships.

## Compatibility

Schema v1 remains accepted for historical annotation-only deliveries and does not
modify series membership. Use v2 for new catalog releases. A publication is
transactional, versioned and explicit; page views do not recompute annotations.

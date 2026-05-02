# Book cover assets

## Variants (width targets)

We ship **three** rasters per book. Each variant is produced by scaling to a **fixed width** (**240**, **480**, or **720** px); **height is not forced**. The pipeline **preserves each book’s original aspect ratio** (covers differ by edition and publisher—no universal 2∶3 assumption in the files themselves).

| Max width | Typical use |
|-----------|-------------|
| **240** | Small thumbnails (e.g. ratings drawer list) |
| **480** | Summary / sheet header cover |
| **720** | Grid cards, search results, primary list UI |

Prefer **AVIF** (fallback to WebP/JPEG elsewhere if needed). Avoid storing a single giant master for UI surfaces—they hurt LCP and waste bandwidth.

## Display on book cards

The **`BookCard`** media area stays a fixed **portrait slot** (`aspect-ratio: 2 / 3`) with **`object-fit: cover`**, as today. For typical **portrait-ish** covers, the image fills the slot (edges may crop). For covers **wider than they are tall** (“landscape” in layout terms), `cover` crops heavily on the sides; you may instead want **`object-fit: contain`** or letterboxing **when you know** the asset is landscape (see tracking below).

## File naming

Pattern:

```text
{numeric_book_id}-{width}.avif
```

Examples: `10000-240.avif`, `10000-480.avif`, `10000-720.avif`

- **`numeric_book_id`**: Stable catalog id (same id as elsewhere in DB/API).
- **`width`**: Target width tier (`240`, `480`, or `720`).

Placement (e.g. CDN path) is a separate concern; keep the **basename** consistent so apps can derive URLs from id + tier.

## Tracking non-portrait covers (optional)

**Yes—you can track it.** During ingest / resize, read each image’s **pixel width and height**, then persist e.g. **`cover_aspect_ratio`** (`width ÷ height`) or **`cover_is_landscape`** (`width > height`) **next to the variant URLs** in whichever system owns the assets.

### Separate image database

If cover files and their metadata live in a **different DB** than the main book catalog (Supabase in this app):

- Store **per-variant dimensions** (or derived flags) in the **image DB** at processing time—same place you store paths/URLs for `{id}-240.avif`, etc.
- The **book catalog** stays the source for title, author, ids, and references to “has a cover”; the **image service** (or image DB API) is the source for **file truth** (URLs, width, height, orientation).
- The **app** still needs that metadata on the wire. Practical patterns:
  - **Image API** returns metadata with the URL (e.g. by `book_id` or basename), and the Svelte app maps it into **`Book`** or a parallel `coverMeta` object; or
  - **Denormalize**: copy a tiny field (e.g. `cover_is_landscape`) onto the catalog DB when the image pipeline finishes, so existing book queries stay one round-trip; the image DB remains authoritative and you re-sync on reprocess.

Avoid relying on frontend-only `naturalWidth` / `naturalHeight` for layout: it runs **after** decode and is weaker for CLS. Optional for debugging or one-off tools.

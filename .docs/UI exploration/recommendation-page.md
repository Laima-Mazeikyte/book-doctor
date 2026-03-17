# Ignore this -> this has already been tried and should not be referenced  
  
Recommendation card & page — UI exploration

Design exploration for a **dedicated recommendation card** used on `/rate/recommendations` (and reusable elsewhere). The card is distinct from the rating-list `BookCard`: no star rating, includes summary and genre tags, supports reveal interactions, and has a bookmark action.

---

## 1. Requirements summary

### 1.1 Placement & layout

- **Primary location:** Recommendations area, e.g. `http://localhost:5175/rate/recommendations`.
- **Reuse:** Likely reused in other areas later (e.g. combined recommendations section).
- **Layout:** **Grid of cards** (no carousel). Ample space — cards can be **bigger than in the rating area**.
- **Quantity:** 10 per request currently; possible future “combined recommendations” section (deduplicated across runs).

### 1.2 Card content


| Element            | Requirement                                                                                                                                                                                     |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Book cover**     | Always present.                                                                                                                                                                                 |
| **Title & author** | Visible at all times. If flippable: on flip side is enough; if single large card, next to cover.                                                                                                |
| **Summary**        | ~3 sentences. Attached to data (DB has short summary; placeholders for now). Long summaries: **“Show more”** pattern.                                                                           |
| **Star rating**    | **None** on recommendation cards. Could be added as a hidden action (maybe the user has already read it but did forgot to rate, mayve having a 'Read it' button which reveals the star ratings) |
| **Genre tags**     | Up to 10; from data later. **First tag** always Fiction or Non-Fiction; then 2–3+ other genres. Same styling for now; placeholders (e.g. “Fiction”, “Mystery”, “Romance”).                      |
| **Bookmark**       | Top-left on **both sides**. Generous hit area. **Does not flip the card.** Saves to “Plan to Read” (section TBD).                                                                               |


### 1.3 Interaction & affordance

- **Reveal:** Summary can be hidden initially and revealed on interaction.
- **Touch:** Tap to flip (or reveal); tap again to flip back. **Visible affordance** on touch (e.g. hint that card is tappable, best if it says 'See Summary').
- **Desktop:** Click to flip; **affordance can appear on hover** (e.g. “Click to read summary”).
- **Bookmark:** Separate control; activating it must **not** trigger flip.

### 1.4 Accessibility

- **Screen readers:** Summary must be available to assistive tech **without requiring a flip** (e.g. in DOM, visible or not).
- **Keyboard:** Full keyboard support; **Enter (or Space) to flip** when focus is on the card.

### 1.5 Design system

- Follow **same general style** as the app; new decisions where function differs.
- Use **design system tokens** only: semantic tokens from `semantic.css` / [TOKENS.md](../TOKENS.md), primitives via semantic layer. See [UX-UI.md](../UX-UI.md).
- **Minimum tap target:** `--min-tap`; focus visible with `:focus-visible`.

---

## 2. Data & placeholders

- **Summary:** Field exists (e.g. book short summary in DB). For now: **placeholder of 3 sentences**, same for every book.
- **Genres:** Not wired to data yet. **Placeholder tags:** first = “Fiction” or “Non-Fiction”; then 2–3 fake genres (e.g. “Mystery”, “Romance”, “Literary Fiction”). Design for up to 10.
- **“Why recommended”:** Not needed for now.
- **Empty state:** Leave as is for now.

---

## 3. Interaction options (exploration)

Below are several concrete patterns. Goals: creative reveal, clear affordance, accessible, and consistent with tokens/layout.

---

### Option A — Flippable card (front = cover, back = summary + meta)

**Idea:** Card has two faces. Front: cover (+ optional title/author strip). Back: summary, title, author, genre tags, bookmark. Flip on click/tap (would like the tap area to be on bottom left, be really generous); affordance on hover (desktop) or always-on hint (touch).

**Pros**

- Clear “two sides”; summary doesn’t compete with cover.
- Familiar metaphor (card flip).
- Works with “author/title on flip side only” requirement.

**Cons**

- Slightly more implementation (3D or 2D flip, preserve focus/live region).
- Need to ensure bookmark on both sides doesn’t accidentally trigger flip (separate hit area / `stopPropagation`).

**Interaction animation**

- **Vertical flip** (like a card): natural “turn over”.

---

## 4. Implementation notes (when you build)

- **Component:** New component (e.g. `RecommendationCard.svelte`), separate from `BookCard`. Use semantic tokens only; `--color-card-bg`, `--radius`, `--shadow-`*, `--space-`*, `--min-tap`.
- **Grid:** Keep grid on recommendations page; increase card size (e.g. larger `minmax` or fixed column count) so cards have “ample space.”
- **Summary in DOM:** For flip/reveal variants, keep summary in the DOM and use `aria-hidden` / visibility or `inert` for visual hide only, so screen readers get it without flipping.
- **Keyboard:** Card or a “reveal” button focusable; Enter/Space toggles flip. Bookmark is a separate focusable control.
- **“Show more”:** When summary exceeds ~3 sentences, truncate and add “Show more” that expands in place (no navigation).

---

## 6. Open decisions (to resolve when implementing)

1. **Fiction/Non-Fiction tag:** Same style as other tags for now; later could use a different token (e.g. pill vs chip) if needed.
2. **Combined recommendations:** When we add a deduplicated “combined” section, reuse the same card component; only data source changes.
3. **Plan to Read:** Bookmark target (list/section) and API are out of scope here; card only needs a bookmark control that doesn’t flip the card.

---

*Doc based on product requirements and follow-up answers. Aligns with [UX-UI.md](../UX-UI.md) and [TOKENS.md](../TOKENS.md).*
# UX/UI design rules

Single source of truth for design decisions. Use this doc to stay consistent and onboard quickly.

---

## Overview

- **Mobile-first**, **minimal**, **accessible**.
- Design tokens and layout live in code; this doc records decisions and points to them.

---

## Style architecture (three layers)

Styles are split into three files, loaded in order:

1. **Primitives** – `src/lib/styles/primitives.css`  
   Raw values only (colors, spacing, typography, radius, shadows, motion). No semantic names.

2. **Semantic** – `src/lib/styles/semantic.css`  
   Tokens that reference primitives only (e.g. `--color-bg`, `--color-text`, `--radius`). Use these in components and base.

3. **Base** – `src/app.css`  
   Imports primitives and semantic, then defines reset, html/body, main, skip-link, links, buttons. Uses only semantic tokens.

**Token reference:** See [.docs/TOKENS.md](TOKENS.md) for a scannable list of primitives and semantic tokens.

---

## Design principles

- **Mobile-first:** Base styles for small screens; enhance for larger viewports.
- **Minimal:** Restrained palette, clear hierarchy, no decorative clutter.
- **Accessible:** Focus visible (`:focus-visible`), skip link to main content, minimum tap target `--min-tap`. See `src/app.css` for focus and skip-link styles.

---

## Scrollbar

- Use **`scrollbar-gutter: stable`** on `html` (in `src/app.css`) so the browser reserves space for the scrollbar.
- Prevents layout shift when the vertical scrollbar appears or disappears on overflow.

---

## Color system

- **Primitives** define the palette in `src/lib/styles/primitives.css` (e.g. `--primitive-gray-50`, `--primitive-accent-solid`).
- **Surfaces** (cards, header, inputs) use `--primitive-surface` via `--color-card-bg`; it is white in light mode and dark gray in dark mode. Do not use `--primitive-white` for surfaces.
- **On-accent** content (e.g. primary button text) uses `--primitive-white`; it stays white in both modes.
- **Semantic** tokens in `src/lib/styles/semantic.css`: `--color-bg`, `--color-text`, `--color-text-muted`, `--color-border`, `--color-accent`, `--color-focus`, `--color-card-bg`, `--color-toggle-thumb`, `--color-error-*`, etc.
- **Dark mode:** `@media (prefers-color-scheme: dark)` overrides primitives in `primitives.css`; no manual toggle. Follows standard practice: light text on dark backgrounds, no large white surfaces.
- **Accessibility:** Contrast target is **WCAG 2.1 AA** (4.5:1 for normal text, 3:1 for large text and UI components).

---

## Layout & spacing

- **Content width:** `--content-width-narrow` (52rem) and `--content-width-wide` (85rem), used on `main` in `src/app.css`.
- **Main padding:** `var(--space-5) var(--space-4)` (see `main` in `src/app.css`).
- **Rate page:** Extra bottom padding for the sticky bar and safe area: `var(--space-24)` plus `env(safe-area-inset-bottom, 0px)` (see `main.rate-page`).

---

## Components

- All reusable UI lives in **`src/lib/components/`** (flat folder). Use only semantic tokens; no hardcoded colors, spacing, or typography.
- **Skip link:** `SkipLink.svelte` – “Skip to main content” for keyboard users.
- **Header:** `AppHeader.svelte` – app header with inner max-width.
- **Buttons:** `Button.svelte` – variants `primary`, `secondary`, `tertiary`, `link`; optional icon slot (icon-only = icon button, `aria-label` required).
- **Cards / patterns:** `BookCard` (route `context` prop; helpers in `book-card/`), `RatingsBar`, etc.; use `--color-card-bg`, `--book-card-*` grid tokens in `app.css`, `--radius`, and other semantic tokens.

---

## Safe areas

- Use **`env(safe-area-inset-bottom, 0px)`** where content sits above device chrome (e.g. home indicator).
- Currently used in `main.rate-page` bottom padding in `src/app.css`.

---

## Changelog / decisions

| Date       | Decision |
| ---------- | -------- |
| 2025-03-13 | Scrollbar: use `scrollbar-gutter: stable` on `html` to avoid layout shift when scrollbar appears. |
| 2025-03-13 | Styles split into primitives.css, semantic.css, and base (app.css). TOKENS.md added. Components in `src/lib/components/` use semantic tokens only. |
| 2025-03-13 | Color refactor: primitive-surface and primitive-toggle-thumb for dark mode; card-bg uses surface; WCAG AA contrast target documented. |

# UX/UI design rules

Single source of truth for design decisions. Use this doc to stay consistent and onboard quickly.

---

## Overview

- **Mobile-first**, **minimal**, **accessible**.
- Design tokens and layout live in code; this doc records decisions and points to them.

---

## Design principles

- **Mobile-first:** Base styles for small screens; enhance for larger viewports.
- **Minimal:** Restrained palette, clear hierarchy, no decorative clutter.
- **Accessible:** Focus visible (`:focus-visible`), skip link to main content, minimum tap target `--min-tap: 44px`. See `src/app.css` for focus and skip-link styles.

---

## Scrollbar

- Use **`scrollbar-gutter: stable`** on `html` (in `src/app.css`) so the browser reserves space for the scrollbar.
- Prevents layout shift when the vertical scrollbar appears or disappears on overflow.

---

## Color system

- All colors are CSS custom properties in `:root` in **`src/app.css`**.
- Semantic tokens: `--color-bg`, `--color-text`, `--color-text-muted`, `--color-border`, `--color-accent`, `--color-focus`, `--color-card-bg`, etc.
- **Dark mode:** `@media (prefers-color-scheme: dark)` overrides `:root`; no manual toggle.

---

## Layout & spacing

- **Content width:** `max-width: 52rem`, centered with `margin: 0 auto`.
- **Main padding:** `1.25rem 1rem` (see `main` in `src/app.css`).
- **Rate page:** Extra bottom padding for the sticky bar and safe area: `6rem` plus `env(safe-area-inset-bottom, 0px)` (see `main.rate-page`).

---

## Components / patterns

- **Skip link:** “Skip to main content” for keyboard users; see `.skip-link` in `src/app.css`.
- **Header:** App header with inner max-width and padding; see `src/routes/+layout.svelte`.
- **Main:** Single `<main id="main">` per layout; content lives inside.
- **CTA:** Primary actions use `.cta` (e.g. “Start rating” on home); min tap target, accent background.
- **Cards:** `BookCard`, `RatingsBar`; use `--color-card-bg`, `--radius`, etc.

---

## Safe areas

- Use **`env(safe-area-inset-bottom, 0px)`** where content sits above device chrome (e.g. home indicator).
- Currently used in `main.rate-page` bottom padding in `src/app.css`.

---

## Changelog / decisions

| Date       | Decision |
| ---------- | -------- |
| 2025-03-13 | Scrollbar: use `scrollbar-gutter: stable` on `html` to avoid layout shift when scrollbar appears. |

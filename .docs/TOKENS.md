# Design tokens reference

Quick reference for primitives and semantic tokens. Definitions live in `src/lib/styles/`.

---

## Layer order

1. **Primitives** (`primitives.css`) – raw values (hex, rem, px). No semantic names.
2. **Semantic** (`semantic.css`) – tokens that reference primitives only. Use these in components and base.
3. **Base** (`app.css`) – reset, html/body, main, links, buttons. Imports primitives and semantic.

---

## Primitives

| Group | Tokens |
| ----- | ------ |
| **Colors** | `--primitive-white`, `--primitive-gray-50` … `--primitive-gray-900`, `--primitive-blue-500`, `--primitive-blue-100`, `--primitive-sand`, `--primitive-red-50`, `--primitive-red-200`, `--primitive-red-800` |
| **Spacing** | `--primitive-space-1` (0.25rem) … `--primitive-space-24` (6rem) |
| **Typography** | `--primitive-font-size-xs` … `--primitive-font-size-3xl`, `--primitive-font-weight-normal|medium|semibold`, `--primitive-line-height-tight|normal|relaxed`, `--primitive-duration-fast`, `--primitive-duration-normal` |
| **Radius** | `--primitive-radius-xs`, `--primitive-radius-sm`, `--primitive-radius-md`, `--primitive-radius-lg`, `--primitive-radius-pill` |
| **Shadows** | `--shadow-card`, `--shadow-card-hover`, `--shadow-input`, `--shadow-drawer`, `--shadow-toggle` (in primitives) |
| **Motion** | `--ease-default` |

---

## Semantic (use these in components)

| Group | Tokens |
| ----- | ------ |
| **Background** | `--color-bg`, `--color-bg-muted`, `--color-bg-hover`, `--color-card-bg`, `--color-card-placeholder-bg` |
| **Text** | `--color-text`, `--color-text-muted` |
| **Border** | `--color-border`, `--color-border-hover` |
| **Accent / focus** | `--color-accent`, `--color-accent-bg`, `--color-focus` |
| **Error** | `--color-error-bg`, `--color-error-border`, `--color-error-text` |
| **Button primary** | `--color-button-primary-bg`, `--color-button-primary-text` |
| **Button secondary** | `--color-button-secondary-bg`, `--color-button-secondary-text`, `--color-button-secondary-border`, `--color-button-secondary-hover-bg`, `--color-button-secondary-hover-border` |
| **Button tertiary** | `--color-button-tertiary-bg`, `--color-button-tertiary-text`, `--color-button-tertiary-hover-bg` |
| **Button link** | `--color-button-link-text`, `--color-button-link-hover-text` |
| **Layout** | `--min-tap`, `--radius`, `--radius-sm`, `--radius-md`, `--radius-pill`, `--content-width-narrow`, `--content-width-wide` |
| **Shadow** | `--shadow-focus-input` |
| **Spacing** | `--space-1` … `--space-24` |
| **Typography** | `--font-size-xs` … `--font-size-3xl`, `--font-weight-normal|medium|semibold`, `--line-height-tight|normal|relaxed` |
| **Motion** | `--duration-fast`, `--duration-normal` |

---

## Dark mode

Primitives switch via `@media (prefers-color-scheme: dark)` in `primitives.css`. Semantic tokens stay the same; they resolve to the updated primitive colors.

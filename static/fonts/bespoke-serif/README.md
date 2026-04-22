# Bespoke Serif (web bundle)

**Source:** [Fontshare — Bespoke Serif](https://www.fontshare.com/fonts/bespoke-serif)  
**Design:** Jeremie Hornus, Theo Guillard, Morgane Pambrun, Alisa Nowak, Joachim Vu — © Indian Type Foundry  

Use only under the license terms supplied with your download.

## Layout in this repo

```
static/fonts/bespoke-serif/
├── README.md
├── bespoke-serif.css    # @font-face rules (paths assume this folder is served as /fonts/bespoke-serif/)
└── fonts/               # woff2, woff, ttf, eot
```

Files in `static/` are served from the site root. This bundle is available at:

- Stylesheet: `/fonts/bespoke-serif/bespoke-serif.css`
- A single face file, for example: `/fonts/bespoke-serif/fonts/BespokeSerif-Regular.woff2`

## Use in SvelteKit

In `src/app.css` (or another global stylesheet), import the public URL:

```css
@import '/fonts/bespoke-serif/bespoke-serif.css';
```

`url('fonts/…')` inside `bespoke-serif.css` is resolved relative to that stylesheet, so no path edits are needed as long as this folder stays together.

## CSS font-family names

Each static weight is a separate family name (as shipped):

| `font-family` |
| --- |
| `BespokeSerif-Light` |
| `BespokeSerif-LightItalic` |
| `BespokeSerif-Regular` |
| `BespokeSerif-Italic` |
| `BespokeSerif-Medium` |
| `BespokeSerif-MediumItalic` |
| `BespokeSerif-Bold` |
| `BespokeSerif-BoldItalic` |
| `BespokeSerif-Extrabold` |
| `BespokeSerif-ExtraboldItalic` |
| `BespokeSerif-Variable` |
| `BespokeSerif-VariableItalic` |

Example:

```css
.headline {
	font-family: 'BespokeSerif-Medium', Georgia, serif;
}
```

## Variable fonts

`BespokeSerif-Variable` and `BespokeSerif-VariableItalic` use `font-weight: 300 800` on the `@font-face` rule. Set weight on the element as usual, or tune the axis explicitly:

```css
.variable-demo {
	font-family: 'BespokeSerif-Variable', Georgia, serif;
	font-weight: 550;
	font-variation-settings: "wght" 550;
}
```

Axis: **`wght`**, range **300–800**.

## Optional cleanup

For smaller deploys you can keep only `.woff2` (and optionally `.woff`) in `fonts/` and remove the matching `url(...)` lines from `bespoke-serif.css`. Modern browsers do not need `.eot` or `.ttf` for web delivery.

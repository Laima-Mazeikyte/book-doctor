# Book Doctor

The SvelteKit frontend for browsing, rating, and receiving book recommendations.

## Requirements

- **Node 22.12 or later**, required by the current Vite and Supabase dependencies.
- **pnpm 9.15.9**, as declared in `package.json`.

For the rate-entry changes, start with the [developer testing handoff](scripts/diagnostics/rate-entry-developer-handoff.md). It covers the shared database, test commands, expected UI behavior, and the open performance target.

## Environment variables

Copy `.env.example` to `.env` and fill in the values:

- `VITE_SUPABASE_URL` – your Supabase project URL
- `VITE_SUPABASE_ANON_KEY` – your Supabase anon/public key
- `PUBLIC_BUNNY_COVERS_BASE` – Bunny.net pull zone base URL for book covers (e.g. `https://your-pullzone.b-cdn.net`). Cover images are requested as `{base}/{book_id}-720.avif`, where `book_id` is the ULID catalog ID. Optional; if unset, covers are omitted.

The browser also supports `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_ANON_KEY`; the server currently requires the `VITE_*` pair above. If both pairs are configured, point them at the same Supabase project. Use the existing shared project and a separate test account for this branch. Its `get_rate_feed_bootstrap` RPC is already installed; do not replay the migration or reset the shared database to start local testing.

### Password reset (forgot password)

The app sends recovery links to **`/auth/reset-password`** on your site origin. In the [Supabase dashboard](https://supabase.com/dashboard) → **Authentication** → **URL configuration**, add that URL to **Redirect URLs** (e.g. `https://your-domain.netlify.app/auth/reset-password` for production). Local entries are already listed in `supabase/config.toml` for the Supabase CLI stack.

## Developing

Install dependencies and start the dev server (this project uses [pnpm](https://pnpm.io)):

```sh
pnpm install --frozen-lockfile
pnpm run dev

# or start the server and open the app in a new browser tab
pnpm run dev -- --open
```

For an existing checkout with a running Vite server, stop that server normally after installing dependencies, restart with `pnpm dev --force`, and fully reload the browser. This rebuilds optimized dependencies after the Supabase SDK upgrade without clearing the stored session or pending saves.

## Checking changes

```sh
pnpm exec playwright install chromium
pnpm run check
pnpm exec vitest run
```

See the [testing handoff](scripts/diagnostics/rate-entry-developer-handoff.md#automated-checks) for focused end-to-end commands and the separate production-preview timing benchmark.

## Building

```sh
pnpm run build
pnpm run preview
```

The project uses the Netlify adapter. Production deployment and reconciliation of the manually installed feed migration are deferred; local testing does not require either operation.

# Local development setup

This guide describes how to run **book-doctor** on your machine. The app is a [SvelteKit](https://svelte.dev/docs/kit) project that talks to [Supabase](https://supabase.com/) for auth and data. The repo uses **pnpm** only (`package.json` → `packageManager`).

## Prerequisites

| Requirement | Notes |
|-------------|--------|
| **Node.js** | Use a current LTS release (for example **22.x**). The project does not pin `engines` in `package.json`; if install or build fails, upgrade Node. |
| **pnpm** | **9.15.9** is declared in `package.json`. Enable via Corepack (recommended): `corepack enable` then `corepack prepare pnpm@9.15.9 --activate`. |
| **Git** | To clone the repository. |

## 1. Clone and install

```sh
git clone <repository-url>
cd book-doctor
pnpm install
```

## 2. Environment variables

Create a `.env` file in the project root by copying the example file:

```sh
cp .env.example .env
```

Fill in values as needed. The table below matches `.env.example`.

| Variable | Required for basic app | Purpose |
|----------|-------------------------|--------|
| `VITE_SUPABASE_URL` | **Yes** | Supabase project URL. Server code loads this at startup; if missing, the app throws when server modules load. |
| `VITE_SUPABASE_ANON_KEY` | **Yes** | Supabase anon (public) key. Same note as above. |
| `PUBLIC_SUPABASE_URL` | **Yes** (browser client) | Same URL as above, for the browser Supabase client (`$env/static/public`). |
| `PUBLIC_SUPABASE_ANON_KEY` | **Yes** (browser client) | Same anon key as above. |
| `SUPABASE_SERVICE_ROLE_KEY` | No | Service role key for server features that bypass RLS (for example webhook / recommendation flows). |
| `SUPABASE_WEBHOOK_SECRET` | No | Optional shared secret for validating webhook requests. |
| `BOOKDOC_RECOMMEND_URL` | No | Optional external recommendation API. |
| `PUBLIC_BUNNY_COVERS_BASE` | No | Base URL for book cover images (Bunny.net pull zone). If unset, covers are omitted. |

**Practical tip:** For local development, set **`VITE_*` and `PUBLIC_*` pairs to the same URL and the same anon key** so both server and browser stay in sync.

### Password reset (forgot password)

Recovery links target **`/auth/reset-password`** on your site. For a **hosted** Supabase project, add that URL under **Authentication → URL configuration → Redirect URLs** in the Supabase dashboard (for example `https://your-app.netlify.app/auth/reset-password`).

For **local Supabase CLI** stacks, `supabase/config.toml` already lists common dev URLs (including `http://127.0.0.1:5173/auth/reset-password` for the default Vite port).

## 3. Supabase backend

You need a database and Supabase Auth that match this project’s schema (migrations live in `supabase/migrations/`). Two common approaches:

### Option A — Local Supabase (CLI + Docker)

1. Install the [Supabase CLI](https://supabase.com/docs/guides/cli/getting-started) and ensure Docker is running.
2. From the project root:

   ```sh
   supabase start
   ```

3. The CLI prints the local **API URL** and **anon key**. Put them in `.env` as `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `PUBLIC_SUPABASE_URL`, and `PUBLIC_SUPABASE_ANON_KEY` (see section 2).
4. Migrations and seed are applied according to `supabase/config.toml` (for example on `supabase db reset`). Use the CLI docs if you need to reset or troubleshoot the local database.

Local defaults in this repo include API on port **54321** and Postgres on **54322** (`supabase/config.toml`).

### Option B — Hosted Supabase project

1. Create a project at [supabase.com](https://supabase.com/).
2. In **Project Settings → API**, copy the **URL** and **anon public** key into `.env` (all four variables as in Option A, same values for URL and for key).
3. Apply the schema from this repo to your hosted database (your team’s usual workflow: for example `supabase link` and `supabase db push`, or run migration SQL manually). Coordinate with the team so your database version matches **Postgres major version 17** if that is what production uses (`supabase/config.toml` → `[db]` `major_version`).

## 4. Run the dev server

```sh
pnpm run dev
```

Open the URL shown in the terminal (Vite’s default is **http://localhost:5173/**). You can also use `pnpm run dev -- --open` to open a browser tab.

The dev server is configured to listen on all interfaces and allows the hostname `book-doctor.test` if you map it in `/etc/hosts` (`vite.config.ts`).

## 5. Quality checks and tests

| Command | What it does |
|---------|----------------|
| `pnpm run check` | Type-check with `svelte-check`. |
| `pnpm run lint` | Prettier check + ESLint. |
| `pnpm run format` | Write Prettier formatting. |
| `pnpm run test:unit` | Unit / component tests (Vitest). |
| `pnpm run test:e2e` | End-to-end tests (Playwright); runs `build` + `preview` on port **4173** per `playwright.config.ts`. |

Before first e2e run, install browser binaries:

```sh
pnpm exec playwright install
```

## 6. Production-like build (optional)

```sh
pnpm run build
pnpm run preview
```

Deployment uses the Netlify adapter (`@sveltejs/adapter-netlify`); `netlify.toml` documents env keys omitted from secret scanning for publishable Supabase values.

## Troubleshooting

- **“Missing Supabase environment variables”** — Ensure `.env` exists and contains **`VITE_SUPABASE_URL`** and **`VITE_SUPABASE_ANON_KEY`**, then restart the dev server.
- **Browser shows Supabase client errors** — Set **`PUBLIC_SUPABASE_URL`** and **`PUBLIC_SUPABASE_ANON_KEY`** to the same URL and anon key as the `VITE_*` variables.
- **`supabase start` fails** — Confirm Docker is running and ports in `supabase/config.toml` are free.
- **Auth redirect / password reset oddities** — Compare your dev origin (scheme, host, port) with `additional_redirect_urls` in `supabase/config.toml` (local) or the dashboard redirect list (hosted).

For a shorter overview of env vars and scripts, see [`README.md`](README.md).

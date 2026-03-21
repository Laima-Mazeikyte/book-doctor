# sv

Everything you need to build a Svelte project, powered by [`sv`](https://github.com/sveltejs/cli).

## Creating a project

If you're seeing this, you've probably already done this step. Congrats!

```sh
# create a new project
npx sv create my-app
```

To recreate this project with the same configuration:

```sh
# recreate this project
pnpm dlx sv@0.12.7 create --template minimal --types ts --add prettier eslint vitest="usages:unit,component" playwright sveltekit-adapter="adapter:netlify" --install pnpm .
```

## Environment variables

Copy `.env.example` to `.env` and fill in the values:

- `VITE_SUPABASE_URL` – your Supabase project URL
- `VITE_SUPABASE_ANON_KEY` – your Supabase anon/public key
- `PUBLIC_BUNNY_COVERS_BASE` – Bunny.net pull zone base URL for book covers (e.g. `https://your-pullzone.b-cdn.net`). Cover images are requested as `{base}/{book_id}.avif` (e.g. `12.avif`). Optional; if unset, only books with a stored `cover_url` in the database will show a cover.

## Developing

Install dependencies and start the dev server (this project uses [pnpm](https://pnpm.io)):

```sh
pnpm install
pnpm run dev

# or start the server and open the app in a new browser tab
pnpm run dev -- --open
```

## Building

```sh
pnpm run build
pnpm run preview
```

> To deploy your app, you may need to install an [adapter](https://svelte.dev/docs/kit/adapters) for your target environment.

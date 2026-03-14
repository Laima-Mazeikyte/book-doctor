# Supabase Database Webhook (recommendation flow)

This app uses a **Database Webhook** so that when a row is inserted into `recommendation_requests`, Supabase POSTs to the backend at `/webhook/recommend`, which then runs the recommendation logic and writes to `recommendation_log` and `recommendation_items`.

## Configure the webhook in Supabase Dashboard

1. Open your project in [Supabase Dashboard](https://supabase.com/dashboard).
2. Go to **Database → Webhooks** (or **Project Settings → Integrations → Webhooks**).
3. **Create a new webhook:**
   - **Name:** e.g. `on_recommendation_request`
   - **Table:** `recommendation_requests`
   - **Events:** **Insert**
   - **URL:** Your backend base URL + `/webhook/recommend`
     - **Production:** `https://your-backend-host.example.com/webhook/recommend`
     - **Local (Supabase in Docker):** `http://host.docker.internal:4173/webhook/recommend` (use the port your SvelteKit app runs on, e.g. 4173 for preview, 5173 for dev).
   - **HTTP method:** POST
   - **HTTP headers (optional):** If you set `SUPABASE_WEBHOOK_SECRET` in `.env`, add a header so the backend can verify requests, e.g.  
     `x-webhook-secret: <same secret value>`
4. Save.

The webhook sends a JSON body like:

```json
{
  "type": "INSERT",
  "table": "recommendation_requests",
  "schema": "public",
  "record": { "id": 1, "user_id": "uuid-here", "created_at": "..." },
  "old_record": null
}
```

## Optional: SQL trigger (alternative)

If you prefer to define the webhook in SQL (e.g. for version control), you can use a trigger that calls Supabase’s HTTP helper. **Replace the placeholder URL** with your actual backend URL before running.

```sql
-- Example: webhook via trigger (URL is placeholder; update for your environment)
-- create trigger "on_recommendation_request"
-- after insert on "public"."recommendation_requests"
-- for each row
-- execute function supabase_functions.http_request(
--   'https://your-backend-host.example.com/webhook/recommend',
--   'POST',
--   '{"Content-Type":"application/json"}',
--   '{}',
--   '10000'
-- );
```

For **local** development, use `http://host.docker.internal:4173/webhook/recommend` (or your app port) so the container can reach your machine.

## Environment

Server-side env (see `.env.example`):

- **SUPABASE_SERVICE_ROLE_KEY** (required for webhook): Used by the `/webhook/recommend` handler to read `user_ratings` for any user and write `recommendation_log` / `recommendation_items`. Find it in Supabase Dashboard → Project Settings → API → `service_role` (secret).
- **SUPABASE_WEBHOOK_SECRET** (optional): If set, the backend checks the `x-webhook-secret` header and rejects requests that don’t match. Set the **same value** in the webhook’s HTTP headers in the Dashboard.
- **BOOKDOC_RECOMMEND_URL** (optional): BookDoc recommendation API endpoint. When set and the user has ≥10 ratings, the webhook POSTs `{ user_id, ratings }` and expects `{ book_ids }`. If unset, the webhook still runs but returns no recommended books.

**Webhook URL**: Must be reachable from Supabase (for hosted Supabase, use a public or tunneled URL; for local Supabase in Docker, use `host.docker.internal` and your dev server port).

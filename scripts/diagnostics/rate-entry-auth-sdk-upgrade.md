# Auth SDK upgrade and book-cover follow-up (2026-10-25)

## Changes

The dependency and lockfile now resolve `@supabase/supabase-js` and its auth package to **2.118.0**, up from **2.99.1**. The browser keeps its existing lazy shared client and default auth settings. There is no custom lock implementation, auth-storage reset, or rejection suppression.

The [official migration guide](https://github.com/supabase/supabase-js/blob/master/packages/core/auth-js/migrations/lockless-coordination.md) describes the default auth change introduced in 2.107.0: refresh coordination no longer takes `navigator.locks`. In-tab refresh calls share a promise; cross-tab refresh races are handled by the auth server and guarded storage commits. The upgrade removes the path in the reported `NavigatorLockAcquireTimeoutError` stack. The exact reason that the old client's expected contention error escaped in the user's profile remains unproven. The user subsequently confirmed that the auth error is now gone; see the confirmation below.

One additional upgrade behavior was caught in regression testing: PostgREST now retries some failed idempotent reads automatically. Two existing history failure checks timed out because of this added backoff. Both application client factories explicitly set `db.retry: false`, preserving previous failure timing and leaving library retries to the existing application coordinator. Transport test clients use the same setting. A browser regression checks that a synthetic 503 produces one read. Auth refresh handling and the queued library-write retry policy are separate and retain their behavior.

The new SDK requires Node 22 or later; the current Vite dependency raises the combined project minimum to **Node 22.12 or later**, now declared in `package.json`. Local validation uses Node 24.15.0. Verify the future deployment's build/runtime version before that deployment; production has not been updated.

The full book page now applies the existing **30% opacity** treatment to its main cover when Not interested is selected. Known dismissal state applies on first render. If state is not yet available, the cover appears immediately and fades when that state arrives, as requested. Selecting, undoing, or replacing the dismissal with a rating updates the cover immediately through the existing stores. The image stays mounted; the title, actions, and remaining page content stay at full opacity. The cover fallback follows the same treatment. This adds no loading or saving text.

## Verification

- All eight book-page component cases pass, covering saved dismissals, delayed hydration, immediate toggle/undo, and restored brightness after rating.
- All 96 targeted Node cases pass, including session readiness, library reads/writes, recommendation submission/history/exclusions, unified feed responses, and public book endpoints.
- All six auth browser cases pass: session reload, expired-token refresh, concurrent refresh deduplication, late refresh after sign-out, cross-tab refresh/sign-out, and application ownership of database retries. No native auth-lock requests or page errors were observed.
- An isolated run of the actual Vite-transformed SDK module in installed Firefox **158.0.1**, with a temporary profile and synthetic responses, restored valid and expired sessions, refreshed once, and completed a background tick while a native auth lock was deliberately held. It reported no errors or unhandled rejections. The served SDK version was not recorded for that run. A subsequent check found that the running Vite server was still serving 2.99.1; the Firefox result therefore cannot be counted as confirmation of the 2.118.0 upgrade.

The first auth browser runs exposed two harness issues: initial Vite navigation exceeded the default 30-second test budget, and a test used "Sign in" instead of the existing "Log in" label. Navigation now waits for DOM content and uses the same 60-second budget as the library suites; the copy expectation was corrected. No product copy was changed. A separate old UMD diagnostic helper timed out; it is not evidence about application auth. The actual Vite module is the relevant Firefox check above.

The full development browser regression passes all **28** cases (six auth and 22 library/recommendation cases), including anonymous session creation, account isolation, quiet saves at desktop/mobile widths, and durable writes before generation. The production build and all **29** production-preview feed/cache/browser-probe behavioral cases pass. The three strict timing scenarios were excluded from this functional upgrade regression; the previously recorded under-200-ms target remains open. Type checking reports zero errors/warnings; changed source formatting, lint, and whitespace checks pass. No real credentials, live writes, SQL changes, production deployment, or browser auth-storage clearing are part of these automated checks.

## Historical follow-up: running localhost server served the old SDK

After the user reported the same lock rejection, a read-only HTTP check fetched
`http://localhost:5173/src/lib/supabase.ts` and then its actual SDK import. The running
server returned `@supabase_supabase-js.js?v=6a2a7de9` containing version **2.99.1**,
the legacy navigator-lock default, and the lock implementation near the lines in the
reported stack. At that time, the installed dependency and on-disk optimized bundle were 2.118.0,
while the running server's served dependency remained 2.99.1.

This establishes a stale served dependency, not the precise reason the old SDK's
contention exception escapes. The earlier installed-version check did not establish
that the user's dev server was running the upgrade.

The recommended recovery was to stop that dev server normally, run `pnpm dev --force`
from `book-doctor`, and fully reload the browser. This forces dependency optimization
without clearing auth storage. The user subsequently confirmed the error is gone.
Developers updating an existing checkout should use the same dependency rebuild;
this is setup guidance rather than an outstanding restart request.

## User confirmation

On 2026-10-25, the user reported: "The auth error is now gone." The reported console
issue is resolved from the user's perspective. This report does not claim that every
manual session/refresh scenario below was completed or establish the old SDK's exact
exception-escape mechanism. Further investigation of that historical mechanism is not
needed for the font cleanup.

## Manual Firefox checks

Use the existing profile and `http://localhost:5173`, with its normal stored session. Clear the Console output and fully reload the page after the dependency update. Keep font warnings separate from auth results. If an error still names `auth-js@2.99.1`, capture that fact: the tab is still executing the old dependency.

1. Confirm that the existing signed-in account and library restore after a reload. Visit `/rate`, rate/bookmark a book, then reload and confirm the saved state.
2. Explicitly exercise refresh in the Console with the snippet below. It prints only success/error text, never session contents. Confirm that the page remains signed in.
3. Open a second localhost tab. Refresh in one tab, switch between tabs several times, then sign out in one. Confirm that both show signed-out UI and stay signed out after reload. Log in again and verify normal library actions.
4. Open a previously dismissed book. Its cover should fade once saved state is available. Undo, select Not interested again, and rate the book; the cover should follow each action while the text and controls remain unchanged.

```js
(async () => {
	const { getSupabase } = await import('/src/lib/supabase.ts');
	const { error } = await getSupabase().auth.refreshSession();
	console.log(error ? `Refresh failed: ${error.message}` : 'Refresh succeeded');
})().catch((error) => console.error('Refresh check failed:', error.message));
```

The snippet is for the local Vite server. Report the pass/fail steps and any new error message rather than session contents.

## Fonts: subsequent implementation

The user subsequently approved and received route-specific preloads: three for landing,
four for `/rate`, and measured additions for other pages/conditional empty states.
Font files, typography, stylesheet order, and display policies are unchanged. See the
[font validation record](font-preload-validation.md) for before/after bytes and visual checks.

# Request timeouts

Implemented November 4, 2026; recovery fixes consolidated November 5. Uses one
shared timeout primitive and targeted changes at existing callers.

## Shared helper

`src/lib/requests/timeout.ts` provides `withTimeout(operation, options)`,
`RequestTimeoutError`, three timeout constants, and an abortable `wait` for
existing polling loops. There is no new retry framework, global fetch override,
HTTP client layer, policy registry, or database migration.

The helper creates a child AbortController, links optional lifecycle cancellation,
and independently rejects on timeout even when transport or SDK work ignores the
signal. It removes timers/listeners on completion and observes late rejections.
A completed child is detached from its parent; later navigation need not abort it.
Callbacks return data. Features retain their account/generation/revision checks
before publishing state. SDK auth events remain authoritative.

Wrap the complete operation, including response-body parsing and dependent reads:

```ts
const data = await withTimeout(
	async (signal) => {
		const response = await fetch(url, { signal });
		if (!response.ok) throw new Error('Unable to load books');
		return response.json();
	},
	{ signal: navigationController.signal }
);
// Check ownership/generation before publishing data.
```

Successful requests incur no extra network call or fixed delay. JavaScript timers
are subject to event-loop and background-tab scheduling. Aborting an HTTP request
does not guarantee cancellation or rollback of work already accepted by the server.

## Budgets and coverage

| Area                                                                                                          | Deadline                                                                |
| ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Book author, discovery, connections, complete search, corrections, recommendation reads/counts/author options | 15 seconds                                                              |
| Every API handler, including authentication and dependent database reads                                      | 8 seconds total                                                         |
| Book detail SSR                                                                                               | 8 seconds; preserves the existing 503 outage contract                   |
| Auth UI/session waits and ordinary job/report submission acknowledgment                                       | 15 seconds per bounded operation                                        |
| Lab artifact JSON/binary reads and bulk import submission                                                     | 60 seconds per operation                                                |
| Shortlist polling                                                                                             | 20 seconds overall, including pending reads and delays                  |
| Goodreads polling                                                                                             | 30 seconds overall, including pending reads and delays                  |
| Curated-feed polling                                                                                          | 60 seconds overall, including pending reads and delays                  |
| Filtered recommendation polling                                                                               | Existing 120-second pause window; reads/delays capped by remaining time |
| Existing library load/save and latest-feed controllers                                                        | Existing deadlines, retries, queues and cache policies preserved        |
| Not-interested pagination                                                                                     | Existing 15-second AbortSignal timeout preserved                        |

Server handlers share the primitive through a small `withRequestTimeout` adapter.
Timeout responses have a stable `request_timeout` code and private/no-store headers.
The author endpoint retains its existing 503 outage status; other API deadlines use 504. Ordinary validation, authentication and domain errors retain their contracts.
Request-scoped Supabase clients carry the handler signal to downstream requests;
subsequent requests cannot begin after cancellation. SDK database retries remain off.
This does not alter the global browser client or unrelated SDK request behavior.

Search shares one budget across its Edge Function and catalog resolution.
Connections share one budget across selection and optional metadata resolution.
Book-page navigation/account guards, same-author sharing, cached results and visit
snapshots remain in place. Connections now offer local manual retry.

Polling expiry means the UI stops waiting, not that a backend job has failed.
Shortlist retry checks the same request. Goodreads retains confirmed job IDs for
Check again. Existing polling intervals remain unchanged. No automatic write retries
were added.

## Uncertain writes and authentication

- Recommendation submissions show uncertainty after a timeout and block another
  submission from that mounted controller. Filtered submissions do the same.
- A timed-out feed insert blocks further automatic inserts for that owner for the
  current loaded application. Existing jobs can still be read. This is a conservative
  recovery limit until a fresh load or a backend idempotency contract is available.
- Bug-report timeouts preserve the current form and prevent resubmission from it.
- Correction drafts and proposal UUIDs remain intact when Check again refreshes
  context after an uncertain save. Conflict-only Reload proposal deliberately
  restores the server version.
- Bulk-import acknowledgment timeouts show that the import may still be running;
  confirmed import jobs survive status-read failures as well as timeouts and can
  be polled again without another insert. Terminal job failures remain distinct.
- Auth restoration timeouts do not sign out users or start a competing anonymous
  account. Late SDK auth events can recover the session. Stale restoration callbacks
  cannot replace a newer account event. An uncertain anonymous sign-in is not repeated
  while its outcome remains unknown. A shared client-scoped guard retains every
  pending SDK auth mutation until the SDK actually settles, even after its UI
  deadline. Login, sign-up, anonymous sign-in, password changes, sign-out and the
  post-login refresh cannot overlap through these callers. A late definitive SDK
  failure permits a deliberate retry; a still-pending operation stays guarded.
- Successful authentication remains successful if its follow-up claim refresh
  fails or times out: the signed-in event still fires and the modal can close.
  SDK auth events remain authoritative for the actual account/session state.

These guards prevent automatic and immediate repeated writes in the active view;
they are not durable idempotency across reloads, navigation or multiple tabs. Robust
repeatable job creation requires a separate backend contract. No Supabase schema,
RPC or RLS changes were made here.

## Deliberate boundaries

Existing protected library/feed mechanics were not refactored just for uniformity.
Native cover-image loading and prerequisite cover gates are separate from API
operation timeouts. Request deadlines do not claim an end-to-end page-opening limit.
Navigation, animation, worker computation and local file parsing are not HTTP request
operations. Large artifacts retain the more generous explicit budget.

Focused tests cover stalled response bodies, non-cooperative SDK calls, cancellation,
cleanup, compound-operation budgets, polling expiry during reads/sleep, late results,
uncertain submissions, and auth restoration/account changes. Existing server and
browser suites check normal-path behavior and cache/ownership invariants. The
superseded timeout review is retained locally in `temp/prepush-review-archive/`.

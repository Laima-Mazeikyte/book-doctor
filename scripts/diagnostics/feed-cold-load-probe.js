/**
 * feed-cold-load-probe.js
 *
 * Console probe for: "the first /rate visit after the tab has been idle takes 4–6s,
 * every visit after that is ~1s".
 *
 * Paste the whole file into the DevTools console on the deployed site. It defines
 * `window.feedProbe` and does nothing else until you call one of its commands.
 *
 *   feedProbe.report()    post-mortem waterfall of the load that already happened  <-- main tool
 *   feedProbe.session()   is the stored Supabase access token expired right now?
 *   feedProbe.probeApi()  time a bare /api call from an already-warm page (isolates server cold start)
 *   feedProbe.expire()    make the stored token look expired (isolates the auth refresh round trip)
 *   feedProbe.restore()   undo expire()
 *   feedProbe.watch()     live instrumentation for a client-side navigation into /rate
 *   feedProbe.copy()      copy the last report as JSON to the clipboard
 *
 * report() needs no setup: the browser records Resource Timing for every request
 * automatically, so you can navigate to /rate cold, then open the console afterwards.
 * Do NOT reload before running it — a reload discards the cold timeline.
 * Keep DevTools' "Disable cache" OFF; it fakes a much colder load than real users get.
 */
(() => {
	'use strict';

	// The serial chain a cold /rate load walks through, in order:
	//   document (SSR on Netlify) -> app JS -> createClient -> auth token refresh
	//   -> GET /api/feed/latest -> maybe GET /api/books/popular -> cover images
	// Every label below marks one link so report() can price them separately.
	const ROLES = [
		[/\/auth\/v1\/token/i, 'AUTH-REFRESH'],
		[/\/auth\/v1\/user/i, 'AUTH-USER'],
		[/\/auth\/v1\//i, 'AUTH'],
		[/\/rest\/v1\/rpc\//i, 'DB-RPC'],
		[/\/rest\/v1\//i, 'DB'],
		[/\/api\/feed\/latest/i, 'API-FEED-LATEST'],
		[/\/api\/feed/i, 'API-FEED'],
		[/\/api\/books\/popular/i, 'API-POPULAR'],
		[/\/api\/recommendations/i, 'API-RECS'],
		[/\/api\//i, 'API'],
		[/\.(avif|webp|jpe?g|png|gif)(\?|$)/i, 'IMG'],
		[/\.(m?js)(\?|$)/i, 'JS'],
		[/\.css(\?|$)/i, 'CSS'],
		[/\.(woff2?|ttf|otf)(\?|$)/i, 'FONT'],
		[/\.svg(\?|$)/i, 'SVG']
	];

	/** Requests the app itself makes — everything else is static asset traffic. */
	const APP_ROLES = new Set([
		'AUTH-REFRESH',
		'AUTH-USER',
		'AUTH',
		'DB-RPC',
		'DB',
		'API-FEED-LATEST',
		'API-FEED',
		'API-POPULAR',
		'API-RECS',
		'API'
	]);

	const ms = (n) => (n == null || Number.isNaN(n) ? '     —' : `${Math.round(n)}ms`.padStart(6));
	const sec = (n) => (n == null ? '—' : `${(n / 1000).toFixed(2)}s`);

	function classify(url) {
		for (const [re, role] of ROLES) if (re.test(url)) return role;
		return 'OTHER';
	}

	function shortUrl(url) {
		try {
			const u = new URL(url);
			const sameOrigin = u.origin === location.origin;
			const path = u.pathname.length > 48 ? `…${u.pathname.slice(-47)}` : u.pathname;
			return sameOrigin ? path : `${u.host}${path}`;
		} catch {
			return url;
		}
	}

	function navEntry() {
		return performance.getEntriesByType('navigation')[0] || null;
	}

	function resourceRows() {
		return performance
			.getEntriesByType('resource')
			.map((e) => {
				// Cross-origin responses without Timing-Allow-Origin (Supabase, Bunny) expose only
				// startTime / duration / responseEnd. The sub-phases come back as 0 — flag, don't guess.
				const opaque = e.responseStart === 0 && e.duration > 0;
				return {
					role: classify(e.name),
					url: shortUrl(e.name),
					fullUrl: e.name,
					start: e.startTime,
					end: e.responseEnd || e.startTime + e.duration,
					dur: e.duration,
					ttfb: opaque ? null : e.responseStart - e.requestStart,
					dns: opaque ? null : e.domainLookupEnd - e.domainLookupStart,
					tcp: opaque ? null : e.connectEnd - e.connectStart,
					tls:
						opaque || e.secureConnectionStart === 0 ? null : e.connectEnd - e.secureConnectionStart,
					transferBytes: e.transferSize,
					fromCache: e.transferSize === 0 && e.decodedBodySize > 0,
					opaqueTiming: opaque
				};
			})
			.sort((a, b) => a.start - b.start);
	}

	function bar(start, end, windowEnd, width = 46) {
		const scale = width / Math.max(windowEnd, 1);
		const from = Math.max(0, Math.floor(start * scale));
		const len = Math.max(1, Math.round((end - start) * scale));
		return `${' '.repeat(from)}${'█'.repeat(Math.min(len, width - from))}`.padEnd(width);
	}

	/** Windows where no app-level request was in flight — i.e. main-thread or boot time. */
	function idleGaps(rows, until, minMs = 120) {
		const spans = rows
			.filter((r) => APP_ROLES.has(r.role))
			.map((r) => [r.start, r.end])
			.sort((a, b) => a[0] - b[0]);
		const gaps = [];
		let cursor = 0;
		for (const [s, e] of spans) {
			if (s - cursor >= minMs) gaps.push({ from: cursor, to: s, dur: s - cursor });
			cursor = Math.max(cursor, e);
		}
		if (until - cursor >= minMs) gaps.push({ from: cursor, to: until, dur: until - cursor });
		return gaps;
	}

	// `paint`, `largest-contentful-paint` and `longtask` entries are NOT retrievable via
	// performance.getEntriesByType() after the fact — they only reach a PerformanceObserver.
	// Registering with `buffered: true` at paste time replays what the browser already recorded,
	// which is why the probe can still price a load that finished before it was pasted.
	const buffered = { paint: [], lcp: [], longtask: [] };
	for (const [type, sink] of [
		['paint', 'paint'],
		['largest-contentful-paint', 'lcp'],
		['longtask', 'longtask']
	]) {
		try {
			new PerformanceObserver((list) => buffered[sink].push(...list.getEntries())).observe({
				type,
				buffered: true
			});
		} catch {
			/* entry type unsupported in this browser */
		}
	}
	/** Buffered entries arrive on a later task — call before reading `buffered`. */
	const flushBuffered = () => new Promise((r) => setTimeout(r, 50));

	function paintTimes() {
		return {
			fcp: buffered.paint.find((p) => p.name === 'first-contentful-paint')?.startTime ?? null,
			lcp: buffered.lcp.length ? buffered.lcp[buffered.lcp.length - 1].startTime : null
		};
	}

	function longTasks() {
		const tasks = buffered.longtask;
		return {
			count: tasks.length,
			totalMs: tasks.reduce((sum, t) => sum + t.duration, 0),
			top: tasks
				.slice()
				.sort((a, b) => b.duration - a.duration)
				.slice(0, 5)
				.map((t) => ({ startedAt: t.startTime, dur: t.duration }))
		};
	}

	// ---------------------------------------------------------------- session

	const TOKEN_KEY_RE = /^sb-.+-auth-token$/;
	const BACKUP_KEY = '__feedProbe_token_backup';

	function tokenKey() {
		return Object.keys(localStorage).find((k) => TOKEN_KEY_RE.test(k)) ?? null;
	}

	function readStoredSession() {
		const key = tokenKey();
		if (!key) return null;
		try {
			return { key, value: JSON.parse(localStorage.getItem(key)) };
		} catch {
			return { key, value: null };
		}
	}

	function decodeJwt(token) {
		try {
			const [, payload] = token.split('.');
			return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
		} catch {
			return null;
		}
	}

	function session() {
		const stored = readStoredSession();
		if (!stored?.value) {
			console.log('%c[feedProbe] no stored Supabase session in localStorage', 'color:#c60');
			return null;
		}
		const s = stored.value;
		const jwt = s.access_token ? decodeJwt(s.access_token) : null;
		const expiresAt = (s.expires_at ?? jwt?.exp ?? 0) * 1000;
		const secondsLeft = Math.round((expiresAt - Date.now()) / 1000);
		// auth-js refreshes when the token expires within EXPIRY_MARGIN_MS (3 ticks × 30s = 90s).
		const willRefresh = secondsLeft < 90;
		const out = {
			storageKey: stored.key,
			userId: jwt?.sub ?? null,
			isAnonymous: jwt?.is_anonymous ?? null,
			expiresAt: new Date(expiresAt).toISOString(),
			secondsLeft,
			hasRefreshToken: !!s.refresh_token,
			blockingRefreshExpectedOnNextLoad: willRefresh
		};
		console.log(
			`%c[feedProbe] token ${
				secondsLeft < 0 ? `EXPIRED ${-secondsLeft}s ago` : `valid for ${secondsLeft}s`
			} → next page load ${willRefresh ? 'WILL' : 'will NOT'} block on a refresh round trip`,
			`color:${willRefresh ? '#c00' : '#080'};font-weight:bold`
		);
		console.table(out);
		return out;
	}

	function expire(secondsAgo = 300) {
		const stored = readStoredSession();
		if (!stored?.value) return console.warn('[feedProbe] no stored session to expire');
		if (!stored.value.refresh_token)
			return console.warn('[feedProbe] no refresh_token — expiring would sign you out. Aborting.');
		localStorage.setItem(BACKUP_KEY, JSON.stringify(stored.value));
		const next = { ...stored.value, expires_at: Math.floor(Date.now() / 1000) - secondsAgo };
		if (typeof next.expires_in === 'number') next.expires_in = 0;
		localStorage.setItem(stored.key, JSON.stringify(next));
		console.log(
			`%c[feedProbe] stored token marked expired (${secondsAgo}s ago). Backup saved.\n` +
				'Now reload /rate — the load will include a real refresh_token round trip.\n' +
				'feedProbe.restore() puts the original back.',
			'color:#06c'
		);
	}

	function restore() {
		const backup = localStorage.getItem(BACKUP_KEY);
		const key = tokenKey();
		if (!backup || !key) return console.warn('[feedProbe] nothing to restore');
		localStorage.setItem(key, backup);
		localStorage.removeItem(BACKUP_KEY);
		console.log('%c[feedProbe] original session restored', 'color:#080');
	}

	// ---------------------------------------------------------------- api probe

	/**
	 * Times the SvelteKit API endpoints directly from an already-hydrated page.
	 * Nothing else is on the critical path here — no bundle, no client bootstrap, warm
	 * DNS/TLS — so a slow result is the serverless function (or the DB behind it), full stop.
	 * A 401 is a fine measurement: the function still cold-starts to produce it.
	 */
	async function probeApi(paths = ['/api/feed/latest?limit=20', '/api/books/popular?offset=0']) {
		const stored = readStoredSession();
		const token = stored?.value?.access_token ?? null;
		const results = [];
		for (const path of paths) {
			const t0 = performance.now();
			let status = 'network-error';
			let headers = {};
			try {
				const res = await fetch(path, {
					headers: token ? { Authorization: `Bearer ${token}` } : {},
					cache: 'no-store'
				});
				status = res.status;
				for (const h of ['x-nf-request-id', 'age', 'cache-status', 'server-timing', 'x-served-by'])
					if (res.headers.get(h)) headers[h] = res.headers.get(h);
				await res.arrayBuffer();
			} catch (e) {
				status = `error: ${e.message}`;
			}
			results.push({ path, status, ms: Math.round(performance.now() - t0), ...headers });
		}
		console.table(results);
		console.log(
			'%c[feedProbe] run probeApi() twice back-to-back. First slow + second fast = serverless cold start.',
			'color:#06c'
		);
		return results;
	}

	// ---------------------------------------------------------------- live watch

	const live = { fetches: [], dom: [], armed: false };

	function watch() {
		if (live.armed) return console.log('[feedProbe] already watching');
		live.armed = true;
		live.t0 = performance.now();

		const nativeFetch = window.fetch;
		window.fetch = function (...args) {
			const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url ?? String(args[0]));
			const rec = { url: shortUrl(url), role: classify(url), start: performance.now() };
			live.fetches.push(rec);
			return nativeFetch.apply(this, args).then(
				(res) => {
					rec.end = performance.now();
					rec.dur = Math.round(rec.end - rec.start);
					rec.status = res.status;
					rec.nfRequestId = res.headers.get('x-nf-request-id') ?? undefined;
					return res;
				},
				(err) => {
					rec.end = performance.now();
					rec.dur = Math.round(rec.end - rec.start);
					rec.status = `error: ${err.message}`;
					throw err;
				}
			);
		};

		// Skeleton -> real grid is the moment `loadingInitial` flips false.
		const mark = (label) => {
			if (live.dom.some((d) => d.label === label)) return;
			live.dom.push({ label, at: Math.round(performance.now() - live.t0) });
			console.log(
				`%c[feedProbe] ${label} @ ${Math.round(performance.now() - live.t0)}ms`,
				'color:#06c'
			);
		};
		// BookCardGridSkeleton and the real grid are both `ul.rate-page__list.book-card-grid`;
		// only the skeleton carries aria-busy. That flag flipping off *is* `loadingInitial = false`.
		const observer = new MutationObserver(() => {
			if (document.querySelector('.rate-page__list[aria-busy="true"]')) mark('skeleton-visible');
			const grid = document.querySelector('.rate-page__list:not([aria-busy])');
			if (grid?.children.length) mark('first-book-cards-in-dom');
			const img = document.querySelector('.rate-page__list:not([aria-busy]) img');
			if (img?.complete && img.naturalWidth > 0) mark('first-cover-painted');
		});
		observer.observe(document.documentElement, {
			childList: true,
			subtree: true,
			attributes: true
		});

		live.stop = () => {
			window.fetch = nativeFetch;
			observer.disconnect();
			live.armed = false;
		};

		console.log(
			'%c[feedProbe] watching. Now navigate into /rate (client-side), then run feedProbe.report().\n' +
				'Note: a full page reload wipes this — for reload runs, just use report() on its own.',
			'color:#06c'
		);
	}

	// ---------------------------------------------------------------- report

	let lastReport = null;

	async function report() {
		await flushBuffered();
		const n = navEntry();
		const rows = resourceRows();
		const app = rows.filter((r) => APP_ROLES.has(r.role));
		const imgs = rows.filter((r) => r.role === 'IMG');
		const { fcp, lcp } = paintTimes();
		const lt = longTasks();

		const first = (role) => rows.find((r) => r.role === role) ?? null;
		const authRefresh = first('AUTH-REFRESH');
		const feedLatest = first('API-FEED-LATEST');
		const popular = first('API-POPULAR');
		const firstApp = app.length ? app[0].start : null;
		const firstImg = imgs.length ? imgs[0].start : null;

		// Only code that landed *before* the app's first network call counts as boot cost. The dev
		// server (and lazy route chunks in prod) keep pulling modules long after the feed is up;
		// folding those in made the boot stage go negative.
		const bootDeadline = firstApp ?? firstImg ?? Infinity;
		const code = rows.filter((r) => (r.role === 'JS' || r.role === 'CSS') && r.end <= bootDeadline);
		const lastCode = code.length ? Math.max(...code.map((r) => r.end)) : null;

		// The request that actually produced the visible list — /rate renders cards the moment this
		// resolves, so it, not the last app request of any kind, is the "cards are ready" boundary.
		const listReady = Math.max(feedLatest?.end ?? 0, popular?.end ?? 0) || null;
		const lastApp = app.length ? Math.max(...app.map((r) => r.end)) : null;
		const windowEnd = Math.max(lcp ?? 0, firstImg ?? 0, lastApp ?? 0, n ? n.loadEventEnd : 0, 1);
		/** Negative spans mean the two boundaries overlapped — report unknown rather than nonsense. */
		const span = (from, to) => (from == null || to == null || to < from ? null : to - from);

		const docTtfb = n ? n.responseStart - n.requestStart : null;
		const docTotal = n ? n.responseEnd - n.startTime : null;

		console.log(
			'%c══ feedProbe report ══',
			'color:#fff;background:#06c;padding:2px 8px;font-weight:bold'
		);
		console.log(
			`page: ${location.pathname}   nav type: ${n?.type ?? '?'}   captured: ${new Date().toISOString()}`
		);
		if (n?.type === 'reload' || n?.type === 'back_forward')
			console.log(
				'%c⚠ This is a reload/bfcache load — it is the WARM case. Cold numbers need a fresh navigation.',
				'color:#c60'
			);

		// --- stage breakdown -------------------------------------------------
		const stages = [
			{
				stage: '1. document (SSR)',
				startedAt: 0,
				ms: docTtfb,
				detail: `TTFB; total ${sec(docTotal)}${n?.transferSize === 0 ? ' (from cache)' : ''}`
			},
			{
				stage: '2. app JS downloaded',
				startedAt: n?.responseEnd ?? null,
				ms: span(n?.responseEnd, lastCode),
				detail: `${code.length} js/css files on the boot path`
			},
			{
				stage: '3. boot → first app request',
				startedAt: lastCode,
				ms: span(lastCode, firstApp),
				detail: 'hydration + createClient (main thread)'
			},
			{
				stage: '4. auth token refresh',
				startedAt: authRefresh?.start ?? null,
				ms: authRefresh?.dur ?? null,
				detail: authRefresh ? 'BLOCKS authReady → blocks the whole feed load' : 'did not happen'
			},
			{
				stage: '5. GET /api/feed/latest',
				startedAt: feedLatest?.start ?? null,
				ms: feedLatest?.dur ?? null,
				detail: feedLatest ? `TTFB ${ms(feedLatest.ttfb)}` : 'did not happen'
			},
			{
				stage: '6. GET /api/books/popular',
				startedAt: popular?.start ?? null,
				ms: popular?.dur ?? null,
				detail: popular ? `TTFB ${ms(popular.ttfb)}` : 'did not happen (curated feed used)'
			},
			{
				stage: '7. list ready → first cover',
				startedAt: listReady,
				ms: span(listReady, firstImg),
				detail: `${imgs.length} cover images, slowest ${ms(Math.max(0, ...imgs.map((i) => i.dur)))}`
			}
		].map((s) => ({
			stage: s.stage,
			'at (s)': s.startedAt == null ? '—' : sec(s.startedAt),
			'took (ms)': s.ms == null ? '—' : Math.round(s.ms),
			detail: s.detail
		}));
		console.log('%c— stage breakdown —', 'font-weight:bold');
		console.table(stages);

		// --- waterfall -------------------------------------------------------
		console.log('%c— app requests (waterfall) —', 'font-weight:bold');
		if (!app.length) {
			console.log(
				'  none captured. Either the page never booted, or you ran this on a page that does not load the feed.'
			);
		}
		for (const r of app) {
			console.log(
				`${r.role.padEnd(16)} ${sec(r.start).padStart(6)} ${ms(r.dur)}  ${bar(
					r.start,
					r.end,
					windowEnd
				)}  ${r.url}${r.opaqueTiming ? '' : `  [ttfb ${ms(r.ttfb)} dns ${ms(r.dns)} tls ${ms(r.tls)}]`}`
			);
		}

		// --- dead air --------------------------------------------------------
		const gaps = idleGaps(rows, firstImg ?? windowEnd);
		console.log('%c— main-thread / boot gaps (no app request in flight) —', 'font-weight:bold');
		for (const g of gaps)
			console.log(
				`  ${sec(g.from)} → ${sec(g.to)}   ${ms(g.dur)}   ${bar(g.from, g.to, windowEnd)}`
			);
		console.log(
			`  long tasks: ${lt.count}, blocking ${Math.round(lt.totalMs)}ms total` +
				(lt.top.length
					? `, worst ${Math.round(lt.top[0].dur)}ms @ ${sec(lt.top[0].startedAt)}`
					: '')
		);

		// --- paints ----------------------------------------------------------
		console.log(
			`%c— paints — FCP ${sec(fcp)}   LCP ${sec(lcp)}   load ${sec(n?.loadEventEnd)}`,
			'font-weight:bold'
		);
		if (fcp == null)
			console.log(
				'  (paint/LCP/long-task timing is only recorded for tabs that were actually foregrounded — ' +
					'empty here means the load happened in a background tab, not that it was instant.)'
			);

		// --- verdict ---------------------------------------------------------
		const contributions = [
			['SSR document (serverless cold start?)', docTtfb ?? 0],
			['app JS download', span(n?.responseEnd, lastCode) ?? 0],
			['hydration / client bootstrap', span(lastCode, firstApp) ?? 0],
			['Supabase auth token refresh', authRefresh?.dur ?? 0],
			['/api/feed/latest', feedLatest?.dur ?? 0],
			['/api/books/popular', popular?.dur ?? 0],
			['cover images (first paint of a card)', span(listReady, firstImg) ?? 0]
		]
			.filter(([, v]) => v > 0)
			.sort((a, b) => b[1] - a[1]);

		console.log('%c— verdict (largest contributors) —', 'font-weight:bold;color:#06c');
		const total = contributions.reduce((s, [, v]) => s + v, 0) || 1;
		for (const [label, value] of contributions)
			console.log(
				`  ${String(Math.round(value)).padStart(5)}ms  ${String(Math.round((value / total) * 100)).padStart(3)}%  ${label}`
			);

		if (authRefresh)
			console.log(
				`%c  → the token WAS expired: a ${Math.round(authRefresh.dur)}ms refresh sat in front of every feed request.`,
				'color:#c60'
			);
		if (docTtfb != null && docTtfb > 800)
			console.log(
				`%c  → document TTFB ${Math.round(docTtfb)}ms. That is the Netlify function rendering /rate; compare against a warm reload.`,
				'color:#c60'
			);
		for (const r of [feedLatest, popular].filter(Boolean))
			if (r.ttfb != null && r.ttfb > 800)
				console.log(
					`%c  → ${r.url} spent ${Math.round(r.ttfb)}ms waiting on the server (TTFB), not transferring.`,
					'color:#c60'
				);

		if (live.fetches.length) {
			console.log('%c— live watch() capture —', 'font-weight:bold');
			console.table(
				live.fetches.map(({ url, role, dur, status, nfRequestId }) => ({
					role,
					url,
					dur,
					status,
					nfRequestId
				}))
			);
			console.table(live.dom);
		}

		lastReport = {
			capturedAt: new Date().toISOString(),
			page: location.href,
			navType: n?.type ?? null,
			doc: { ttfb: docTtfb, total: docTotal, transferSize: n?.transferSize ?? null },
			stages,
			appRequests: app.map(({ role, url, start, dur, ttfb, dns, tls, transferBytes }) => ({
				role,
				url,
				start: Math.round(start),
				dur: Math.round(dur),
				ttfb: ttfb == null ? null : Math.round(ttfb),
				dns: dns == null ? null : Math.round(dns),
				tls: tls == null ? null : Math.round(tls),
				transferBytes
			})),
			gaps: gaps.map((g) => ({
				from: Math.round(g.from),
				to: Math.round(g.to),
				dur: Math.round(g.dur)
			})),
			longTasks: lt,
			paints: { fcp, lcp, loadEventEnd: n?.loadEventEnd ?? null },
			images: {
				count: imgs.length,
				firstStart: firstImg,
				slowest: Math.max(0, ...imgs.map((i) => i.dur))
			},
			contributions: Object.fromEntries(contributions.map(([k, v]) => [k, Math.round(v)])),
			live: live.fetches.length ? { fetches: live.fetches, dom: live.dom } : undefined
		};
		console.log('%c[feedProbe] feedProbe.copy() copies this run as JSON.', 'color:#888');
		return lastReport;
	}

	async function copy() {
		const payload = JSON.stringify(lastReport ?? (await report()), null, 2);
		try {
			await navigator.clipboard.writeText(payload);
			console.log('%c[feedProbe] report copied to clipboard', 'color:#080');
		} catch {
			console.log(payload);
		}
		return payload;
	}

	window.feedProbe = {
		report,
		session,
		expire,
		restore,
		probeApi,
		watch,
		copy,
		stop: () => live.stop?.()
	};
	console.log(
		'%c[feedProbe] ready.%c  Cold run: navigate to /rate, wait for books, then feedProbe.report()',
		'color:#fff;background:#06c;padding:2px 6px;font-weight:bold',
		'color:inherit'
	);
})();

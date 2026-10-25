/**
 * Paste this file into the Console on the landing page, then:
 *   rateEntryProbe.arm('after / normal / 1')
 * Click Start rating; leave the grid untouched until the refresh settles, then:
 *   rateEntryProbe.report()
 *   rateEntryProbe.copy()
 * Diagnose a missing action timing on the current page: rateEntryProbe.inspect()
 *
 * Works on the old and updated UI. Read-only: no requests, storage changes,
 * authentication inspection, or writes. A full reload removes the probe.
 * Network entries describe completed requests; use the Network panel for pending ones.
 */
(() => {
	'use strict';
	window.rateEntryProbe?.stop();
	const round = (value) => Math.round(value * 10) / 10;
	let label = '';
	let run = null;
	let observer;
	let frame = 0;
	let timeout;
	let waitingForClick = false;
	let observing = false;
	let watchedNodes = [];

	function stop() {
		waitingForClick = false;
		observing = false;
		document.removeEventListener('click', onClick, true);
		observer?.disconnect();
		cancelAnimationFrame(frame);
		clearTimeout(timeout);
		frame = 0;
	}

	function visible(element) {
		const rect = element.getBoundingClientRect();
		if (rect.width <= 0 || rect.height <= 0 || rect.bottom <= 0 || rect.top >= innerHeight)
			return false;
		for (let node = element; node; node = node.parentElement) {
			const style = getComputedStyle(node);
			if (
				style.visibility === 'hidden' ||
				style.visibility === 'collapse' ||
				Number(style.opacity) === 0
			)
				return false;
		}
		return true;
	}

	function inspect() {
		const ratings = [...document.querySelectorAll('.rate-page__list .book-card__star')];
		const first = ratings[0];
		const rect = first?.getBoundingClientRect();
		const enabled = (element) =>
			!element.disabled && element.getAttribute('aria-disabled') !== 'true';
		const result = {
			viewport: { width: innerWidth, height: innerHeight },
			cardCount: document.querySelectorAll('.rate-page__list .book-card').length,
			ratingControlCount: ratings.length,
			enabledRatingControlCount: ratings.filter(enabled).length,
			firstRating: first
				? {
						enabled: enabled(first),
						visible: visible(first),
						top: round(rect.top),
						bottom: round(rect.bottom)
					}
				: null
		};
		return result;
	}

	function sample() {
		frame = 0;
		if (!run || !observing) return;
		const elapsed = performance.now() - run.startedAt;
		const skeleton = document.querySelector('.rate-page__list[aria-busy="true"]');
		if (skeleton && visible(skeleton)) {
			if (run.firstCardMs === null) run.skeletonBeforeCards = true;
			else run.skeletonReturnedAfterCards = true;
		}
		const card = document.querySelector('.rate-page__list .book-card');
		if (card && visible(card)) {
			if (run.firstCardMs === null) {
				run.firstCardMs = round(performance.now() - run.startedAt);
				run.cardCountAtFirstFrame = document.querySelectorAll('.book-card').length;
				watchedNodes = [...document.querySelectorAll('.book-card')];
			}
			const rating = card.querySelector('.book-card__star');
			const ratingEnabled =
				rating && !rating.disabled && rating.getAttribute('aria-disabled') !== 'true';
			if (run.ratingEnabledMs === null && ratingEnabled) {
				run.ratingEnabledMs = round(performance.now() - run.startedAt);
			}
			if (run.usableRatingMs === null && ratingEnabled && visible(rating)) {
				run.usableRatingMs = round(performance.now() - run.startedAt);
			}
		}
		if (watchedNodes.some((node) => !node.isConnected)) run.initialCardRemoved = true;
		// Keep sampling frames while waiting for cards/actions or an entry fade.
		// Once ready, observe mutations until report/stop or the 20-second cutoff.
		if (run.usableRatingMs === null && elapsed < 20_000) schedule();
	}
	function schedule() {
		if (!frame) frame = requestAnimationFrame(sample);
	}
	function onClick(event) {
		const anchor = event.target instanceof Element ? event.target.closest('a') : null;
		if (
			!waitingForClick ||
			!anchor ||
			event.button !== 0 ||
			event.ctrlKey ||
			event.metaKey ||
			event.shiftKey ||
			event.altKey
		)
			return;
		const target = new URL(anchor.href, location.href);
		if (target.origin !== location.origin || !/\/rate\/?$/.test(target.pathname)) return;
		waitingForClick = false;
		observing = true;
		document.removeEventListener('click', onClick, true);
		run = {
			label,
			origin: location.origin,
			capturedAt: new Date().toISOString(),
			startedAt: performance.now(),
			firstCardMs: null,
			ratingEnabledMs: null,
			usableRatingMs: null,
			cardCountAtFirstFrame: 0,
			skeletonBeforeCards: false,
			skeletonReturnedAfterCards: false,
			initialCardRemoved: false
		};
		observer = new MutationObserver(schedule);
		observer.observe(document.documentElement, {
			subtree: true,
			childList: true,
			attributes: true
		});
		timeout = setTimeout(stop, 20_000);
		schedule();
	}

	function requests() {
		return performance
			.getEntriesByType('resource')
			.flatMap((entry) => {
				const path = new URL(entry.name, location.href).pathname;
				let kind;
				if (/\/api\/feed\/latest\/?$/.test(path)) kind = 'latest-feed';
				else if (/\/api\/feed\/?$/.test(path)) kind = 'feed-poll';
				else if (/\/api\/books\/popular\/?$/.test(path)) kind = 'popular';
				else if (/\/auth\/v1\/token\/?$/.test(path)) kind = 'auth-refresh';
				else return [];
				return [
					{
						kind,
						startRelativeToClickMs: round(entry.startTime - run.startedAt),
						endRelativeToClickMs: round(entry.responseEnd - run.startedAt),
						durationMs: round(entry.duration),
						serverTiming: Array.from(entry.serverTiming ?? [], ({ name, duration }) => ({
							name,
							durationMs: round(duration)
						}))
					}
				];
			})
			.sort((a, b) => a.startRelativeToClickMs - b.startRelativeToClickMs);
	}
	function report() {
		if (!run) {
			console.log('Run rateEntryProbe.arm(label), then click Start rating.');
			return null;
		}
		cancelAnimationFrame(frame);
		frame = 0;
		sample();
		const network = requests();
		const latestBefore =
			network
				.filter((entry) => entry.kind === 'latest-feed' && entry.startRelativeToClickMs < 0)
				.at(-1) ?? null;
		const { startedAt, ...metrics } = run;
		const result = {
			...metrics,
			controlsAtReport: inspect(),
			observedForMs: round(performance.now() - startedAt),
			latestFeedStartedBeforeClick: latestBefore,
			completedFeedRequestsStartedAfterClick: network.filter(
				(entry) => entry.kind === 'latest-feed' && entry.startRelativeToClickMs >= 0
			).length,
			completedRequestsDuringEntry: network.filter((entry) => entry.endRelativeToClickMs >= 0),
			measurement:
				'Animation-frame observation of visible cards/enabled rating; excludes cover completion',
			networkScope:
				'Completed resources only; pending/blocked requests may be absent. No request headers, tokens, titles, or IDs are exported.'
		};
		stop();
		console.log(JSON.stringify(result, null, 2));
		return result;
	}
	window.rateEntryProbe = {
		arm(nextLabel = 'unlabeled') {
			stop();
			label = String(nextLabel);
			run = null;
			watchedNodes = [];
			waitingForClick = true;
			document.addEventListener('click', onClick, true);
			console.log(
				`Armed: ${label}. Click Start rating, wait for the refresh, then run rateEntryProbe.report().`
			);
		},
		report,
		inspect,
		async copy() {
			const result = report();
			if (!result) return;
			const json = JSON.stringify(result, null, 2);
			try {
				await navigator.clipboard.writeText(json);
				console.log('Timing report copied.');
			} catch {
				console.log('Clipboard unavailable; copy the JSON report above.');
			}
		},
		stop
	};
	console.log(
		'Ready. Run rateEntryProbe.arm("before or after / case / trial"), then click Start rating.'
	);
})();

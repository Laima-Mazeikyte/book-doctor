import type { Handle } from '@sveltejs/kit';
import { t } from '$lib/copy';
import { MAINTENANCE_ON, MAINTENANCE_UNTIL, isAllowedDuringMaintenance } from '$lib/maintenance';

/** Seconds until we expect to be back, for the Retry-After header. Falls back to 1h. */
function retryAfterSeconds(): number {
	const target = Date.parse(MAINTENANCE_UNTIL);
	if (Number.isNaN(target)) return 3600;
	const secs = Math.round((target - Date.now()) / 1000);
	return secs > 0 ? secs : 60;
}

/**
 * Self-contained 503 page for routes disabled during maintenance (deep links, crawlers, APIs).
 * The allowed pages (`/`, `/faq`) render the normal app; this is the fallback for everything else.
 * It embeds its own countdown so it doesn't depend on the app bundle.
 */
function maintenancePage(): string {
	const heading = t('maintenance.heading');
	const body = t('maintenance.body');
	const backSoon = t('maintenance.backSoon');
	const etaLabel = t('maintenance.backOnlineLabel');
	const noEta = t('maintenance.noEta');
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>${heading} — ${t('shared.header.siteName')}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; text-align: center;
    padding: 2rem; background: #fbfaf7; color: #1c1b19; }
  main { max-width: 34rem; }
  h1 { font-size: 1.75rem; margin: 0 0 0.75rem; }
  p { font-size: 1.05rem; line-height: 1.5; opacity: 0.85; margin: 0 0 1.5rem; }
  .eta { font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.05em; opacity: 0.6; margin: 0 0 0.5rem; }
  .clock { font-variant-numeric: tabular-nums; font-size: 2.25rem; font-weight: 600; margin: 0; }
</style>
</head>
<body>
<main>
  <h1>${heading}</h1>
  <p>${body}</p>
  <p class="eta" id="eta-label" hidden>${etaLabel}</p>
  <p class="clock" id="clock"></p>
</main>
<script>
  (function () {
    var until = ${JSON.stringify(MAINTENANCE_UNTIL)};
    var target = Date.parse(until);
    var clock = document.getElementById('clock');
    var etaLabel = document.getElementById('eta-label');
    if (isNaN(target)) { clock.textContent = ${JSON.stringify(noEta)}; return; }
    function pad(n) { return String(n).padStart(2, '0'); }
    function tick() {
      var ms = target - Date.now();
      if (ms <= 0) { clock.textContent = ${JSON.stringify(backSoon)}; etaLabel.hidden = true;
        setTimeout(function () { location.reload(); }, 20000); return; }
      etaLabel.hidden = false;
      var s = Math.floor(ms / 1000);
      clock.textContent = pad(Math.floor(s / 3600)) + ':' + pad(Math.floor((s % 3600) / 60)) + ':' + pad(s % 60);
    }
    tick();
    setInterval(tick, 1000);
  })();
</script>
</body>
</html>`;
}

export const handle: Handle = async ({ event, resolve }) => {
	if (MAINTENANCE_ON && !isAllowedDuringMaintenance(event.url.pathname)) {
		return new Response(maintenancePage(), {
			status: 503,
			headers: {
				'content-type': 'text/html; charset=utf-8',
				'retry-after': String(retryAfterSeconds()),
				'cache-control': 'no-store'
			}
		});
	}
	return resolve(event);
};

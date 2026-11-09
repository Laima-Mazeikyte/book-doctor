/** Wait for landing assets to be usable, not for the looping video to finish downloading. */
export async function waitForLandingAssets(signal: AbortSignal): Promise<void> {
	const cleanups: Array<() => void> = [];
	function eventReady(target: EventTarget, ready: () => boolean, events: string[]) {
		if (ready() || signal.aborted) return Promise.resolve();
		return new Promise<void>((resolve) => {
			const finish = () => {
				for (const event of events) target.removeEventListener(event, finish);
				signal.removeEventListener('abort', finish);
				resolve();
			};
			for (const event of events) target.addEventListener(event, finish, { once: true });
			signal.addEventListener('abort', finish, { once: true });
			cleanups.push(finish);
		});
	}
	const landing = document.querySelector('.landing');
	const assets = [
		eventReady(window, () => document.readyState === 'complete', ['load']),
		document.fonts.ready,
		...[...(landing?.querySelectorAll('img') ?? [])].map((image) =>
			eventReady(image, () => image.complete, ['load', 'error'])
		),
		...[...(landing?.querySelectorAll('video') ?? [])].map((video) =>
			eventReady(video, () => video.readyState >= 2 || video.error !== null, [
				'loadeddata',
				'error'
			])
		)
	];
	let cancel = () => {};
	const cancelled = new Promise<void>((resolve) => {
		cancel = resolve;
		signal.addEventListener('abort', cancel, { once: true });
		if (signal.aborted) resolve();
	});
	try {
		await Promise.race([Promise.all(assets), cancelled]);
		if (signal.aborted) return;
		await new Promise<void>((resolve) => {
			let frame = requestAnimationFrame(() => {
				frame = requestAnimationFrame(finish);
			});
			function finish() {
				cancelAnimationFrame(frame);
				signal.removeEventListener('abort', finish);
				resolve();
			}
			signal.addEventListener('abort', finish, { once: true });
		});
	} finally {
		signal.removeEventListener('abort', cancel);
		for (const cleanup of cleanups) cleanup();
	}
}

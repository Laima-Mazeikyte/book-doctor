import { PUBLIC_HCAPTCHA_SITEKEY } from '$env/static/public';
import { loadHcaptchaExplicit } from '$lib/hcaptcha-script';

/**
 * When Supabase Auth → Attack protection requires hCaptcha, anonymous sign-in must
 * send a captcha token (same site key as in the dashboard). Uses an invisible widget.
 */
export async function getHcaptchaTokenForAnonymousAuth(): Promise<string | undefined> {
	const sitekey =
		typeof PUBLIC_HCAPTCHA_SITEKEY === 'string' ? PUBLIC_HCAPTCHA_SITEKEY.trim() : '';
	if (!sitekey || typeof window === 'undefined') return undefined;

	await loadHcaptchaExplicit();
	const hcaptcha = window.hcaptcha;
	if (!hcaptcha?.execute) return undefined;

	return new Promise((resolve, reject) => {
		let settled = false;
		let timeoutId: ReturnType<typeof window.setTimeout>;
		const done = (fn: () => void) => {
			if (settled) return;
			settled = true;
			window.clearTimeout(timeoutId);
			fn();
		};

		timeoutId = window.setTimeout(() => {
			done(() => reject(new Error('hCaptcha timeout')));
		}, 120_000);

		const container = document.createElement('div');
		container.setAttribute('aria-hidden', 'true');
		container.style.cssText = 'position:fixed;left:-9999px;width:1px;height:1px;overflow:hidden;';
		document.body.appendChild(container);

		const cleanup = (widgetId: number) => {
			try {
				hcaptcha.remove(widgetId);
			} catch {
				/* ignore */
			}
			container.remove();
		};

		let widgetId: number;
		try {
			widgetId = hcaptcha.render(container, {
				sitekey,
				size: 'invisible',
				callback: (token: string) => {
					cleanup(widgetId);
					done(() => resolve(token));
				},
				'error-callback': () => {
					cleanup(widgetId);
					done(() => reject(new Error('hCaptcha error')));
				},
				'expired-callback': () => {
					cleanup(widgetId);
					done(() => reject(new Error('hCaptcha expired')));
				}
			});
		} catch (e) {
			container.remove();
			done(() =>
				reject(e instanceof Error ? e : new Error('hCaptcha render failed'))
			);
			return;
		}

		try {
			hcaptcha.execute(widgetId);
		} catch (e) {
			cleanup(widgetId);
			done(() =>
				reject(e instanceof Error ? e : new Error('hCaptcha execute failed'))
			);
		}
	});
}

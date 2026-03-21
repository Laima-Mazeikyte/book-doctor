/** Load hCaptcha with explicit rendering (works when the widget mounts after the script). */
let loadPromise: Promise<void> | null = null;

export function loadHcaptchaExplicit(): Promise<void> {
	if (typeof window === 'undefined') return Promise.resolve();
	if (window.hcaptcha) return Promise.resolve();
	if (loadPromise) return loadPromise;
	loadPromise = new Promise((resolve, reject) => {
		const s = document.createElement('script');
		s.src = 'https://js.hcaptcha.com/1/api.js?render=explicit';
		s.async = true;
		s.onload = () => resolve();
		s.onerror = () => {
			loadPromise = null;
			reject(new Error('Failed to load hCaptcha'));
		};
		document.head.appendChild(s);
	});
	return loadPromise;
}

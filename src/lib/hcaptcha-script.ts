/** Load hCaptcha with explicit rendering (works when the widget mounts after the script). */
let loadPromise: Promise<void> | null = null;

export function loadHcaptchaExplicit(): Promise<void> {
	if (typeof window === 'undefined') return Promise.resolve();
	if (window.hcaptcha) return Promise.resolve();
	if (loadPromise) return loadPromise;
	loadPromise = new Promise((resolve, reject) => {
		const callbackName = `__hcaptchaOnLoad_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
		const globalNs = globalThis as unknown as Record<string, () => void>;

		const finish = () => {
			Reflect.deleteProperty(globalNs, callbackName);
			resolve();
		};

		globalNs[callbackName] = () => {
			finish();
		};

		const s = document.createElement('script');
		s.src = `https://js.hcaptcha.com/1/api.js?onload=${encodeURIComponent(callbackName)}&render=explicit`;
		s.async = true;
		s.defer = true;
		s.onerror = () => {
			Reflect.deleteProperty(globalNs, callbackName);
			loadPromise = null;
			reject(new Error('Failed to load hCaptcha'));
		};
		document.head.appendChild(s);
	});
	return loadPromise;
}

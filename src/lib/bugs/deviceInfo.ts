/**
 * Collect viewport and device info for bug reports. Optional APIs wrapped in try/catch.
 */
export interface DeviceInfo {
	user_agent?: string;
	viewport_width?: number;
	viewport_height?: number;
	screen_width?: number;
	screen_height?: number;
	device_pixel_ratio?: number;
	platform?: string;
	language?: string;
	device_memory?: number;
	hardware_concurrency?: number;
	max_touch_points?: number;
}

export function getDeviceInfo(): { viewport_width: number; viewport_height: number; device_info: DeviceInfo } {
	const viewport_width = typeof window !== 'undefined' ? window.innerWidth ?? 0 : 0;
	const viewport_height = typeof window !== 'undefined' ? window.innerHeight ?? 0 : 0;

	const device_info: DeviceInfo = {};

	try {
		if (typeof navigator !== 'undefined') {
			device_info.user_agent = navigator.userAgent;
			device_info.platform = navigator.platform;
			device_info.language = navigator.language;
			device_info.max_touch_points = navigator.maxTouchPoints;
			device_info.hardware_concurrency = navigator.hardwareConcurrency;
			if ('deviceMemory' in navigator) {
				device_info.device_memory = (navigator as { deviceMemory?: number }).deviceMemory;
			}
		}
	} catch {
		// ignore
	}

	try {
		if (typeof window !== 'undefined' && window.screen) {
			device_info.screen_width = window.screen.width;
			device_info.screen_height = window.screen.height;
			device_info.device_pixel_ratio = window.devicePixelRatio;
		}
	} catch {
		// ignore
	}

	device_info.viewport_width = viewport_width;
	device_info.viewport_height = viewport_height;

	return { viewport_width, viewport_height, device_info };
}

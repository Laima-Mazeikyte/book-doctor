import { defineConfig } from '@playwright/test';
import config from './playwright.config';

// Build first: pnpm run build
// Then: pnpm exec playwright test -c playwright.rate-entry.config.ts
process.env.RATE_FEED_TEST_ORIGIN = 'http://127.0.0.1:4174';
process.env.RATE_FEED_MEASURE = 'true';
export default defineConfig(config, {
	testMatch: '**/rate-feed-cache.e2e.ts',
	workers: 1,
	webServer: {
		command: 'pnpm exec vite preview --host 127.0.0.1 --port 4174',
		port: 4174,
		reuseExistingServer: false
	}
});

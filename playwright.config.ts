import { defineConfig } from '@playwright/test';

export default defineConfig({
	// The prominence release is intentionally mounted by the local-artifact Vite middleware
	// during development; production deployments point PUBLIC_AUTHOR_PROMINENCE_BASE at storage.
	projects: [
		{
			name: 'chromium-webgl',
			use: {
				browserName: 'chromium',
				launchOptions: {
					args: ['--use-gl=angle', '--use-angle=swiftshader']
				}
			}
		}
	],
	webServer: {
		command: 'pnpm exec vite --host 127.0.0.1 --port 4173',
		port: 4173,
		reuseExistingServer: true
	},
	testMatch: '**/*.e2e.{ts,js}'
});

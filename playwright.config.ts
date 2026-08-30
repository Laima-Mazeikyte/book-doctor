import { defineConfig } from '@playwright/test';

export default defineConfig({
	// Author-prominence browser tests consume the same pinned public Supabase release as the app.
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

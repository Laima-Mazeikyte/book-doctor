import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import { sveltekit } from '@sveltejs/kit/vite';
import ViteYaml from '@modyfi/vite-plugin-yaml';
import { localLabArtifacts } from './vite-plugin-local-lab-artifacts';

export default defineConfig({
	plugins: [
		sveltekit(),
		ViteYaml(),
		localLabArtifacts({ prefix: '/best-book-search-local', root: 'temp/best_book_search/handoff' })
	],
	server: {
		// Listen on all local interfaces so http://book-doctor.test:<port> works
		// when that name is mapped to 127.0.0.1 in /etc/hosts (no secrets here).
		host: true,
		// Vite 7+ rejects unknown Host headers unless listed here.
		allowedHosts: ['book-doctor.test']
	},
	optimizeDeps: {
		include: ['lucide-svelte']
	},
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'client',
					browser: {
						enabled: true,
						provider: playwright(),
						instances: [{ browser: 'chromium', headless: true }]
					},
					include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
					exclude: ['src/lib/server/**']
				}
			},

			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});

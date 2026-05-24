import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
	resolve: {
		alias: {
			// `obsidian` is provided by the app at runtime, not installed for tests.
			obsidian: fileURLToPath(new URL('./test/__mocks__/obsidian.ts', import.meta.url)),
		},
	},
	test: {
		environment: 'node',
		include: ['test/**/*.test.ts'],
		coverage: {
			provider: 'v8',
			reporter: ['text', 'html'],
			include: ['src/**/*.ts'],
			exclude: ['src/main.ts', 'src/**/*.d.ts'],
			thresholds: {
				// Pure core must stay well-tested; thin adapters get a lower bar.
				'src/core/**': {
					lines: 90,
					functions: 90,
					branches: 90,
					statements: 90,
				},
				'src/adapters/**': {
					lines: 0,
					functions: 0,
					branches: 0,
					statements: 0,
				},
			},
		},
	},
});

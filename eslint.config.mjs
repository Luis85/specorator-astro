import tseslint from 'typescript-eslint';
import boundaries from 'eslint-plugin-boundaries';
import obsidianmd from 'eslint-plugin-obsidianmd';
import prettier from 'eslint-config-prettier';

// obsidianmd's recommended set enables type-aware rules on every file. Files
// outside the tsconfig program (config scripts, package.json) have no type
// information, so those rules must be turned off there.
const disableTypeAwareRules = {
	...tseslint.configs.disableTypeChecked.rules,
	'obsidianmd/no-plugin-as-component': 'off',
	'obsidianmd/no-view-references-in-plugin': 'off',
	'obsidianmd/no-unsupported-api': 'off',
	'obsidianmd/prefer-file-manager-trash-file': 'off',
	'obsidianmd/prefer-instanceof': 'off',
};

export default tseslint.config(
	{
		ignores: [
			'main.js',
			'dist/**',
			'coverage/**',
			'docs/api/**',
			'node_modules/**',
			// Agent-harness scratch worktrees (Claude Code on the web) — not project source.
			'.claude/**',
			// Machine-generated template embed; kept in sync by `embed:template:check`.
			'src/adapters/generated/**',
			// The bundled Astro project is a separate program, type-checked and
			// built by `npm run verify:template` (Astro `check`), not the plugin gate.
			'templates/**',
		],
	},

	// TypeScript recommended rules.
	...tseslint.configs.recommended,

	// Official Obsidian plugin guideline rules (manifest, DOM APIs, etc.).
	...obsidianmd.configs.recommended,

	// Typed linting for the plugin sources. Several obsidianmd and
	// @typescript-eslint rules need type information; only our TypeScript
	// sources live in the tsconfig.json program.
	{
		files: ['**/*.ts', '**/*.tsx'],
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},

	// Architecture boundaries: pure `core/` vs `adapters/` vs the `main.ts` root.
	// Enforces the ports-and-adapters seam (see docs/REQUIREMENTS.md ARCH-2).
	{
		files: ['src/**/*.ts'],
		plugins: { boundaries },
		settings: {
			'boundaries/elements': [
				{ type: 'core', pattern: 'src/core/**' },
				{ type: 'adapters', pattern: 'src/adapters/**' },
				{ type: 'root', pattern: 'src/main.ts', mode: 'file' },
			],
		},
		rules: {
			'boundaries/element-types': [
				'error',
				{
					default: 'disallow',
					rules: [
						{ from: 'core', allow: ['core'] },
						{ from: 'adapters', allow: ['core', 'adapters'] },
						{ from: 'root', allow: ['core', 'adapters'] },
					],
				},
			],
			// Only adapters/root may import Obsidian and Node built-ins.
			'boundaries/external': [
				'error',
				{
					default: 'disallow',
					rules: [
						{
							from: ['adapters', 'root'],
							allow: ['obsidian', 'electron', 'node:*'],
						},
					],
				},
			],
		},
	},

	// Test files may use Node and the obsidian mock freely. The popout-window
	// affordance rules (window timers / no-globalThis / config-dir) target the
	// Obsidian *runtime*; tests run under Node and legitimately shim those globals,
	// so they don't apply here.
	{
		files: ['test/**/*.ts'],
		rules: {
			'@typescript-eslint/no-explicit-any': 'off',
			'obsidianmd/prefer-window-timers': 'off',
			'obsidianmd/no-global-this': 'off',
			'obsidianmd/hardcoded-config-path': 'off',
		},
	},

	// Config and build scripts (not in the TS program): no type-aware rules.
	{
		files: ['**/*.{js,cjs,mjs}'],
		rules: disableTypeAwareRules,
	},

	// package.json is linted with the JSON language (obsidianmd validates it),
	// so type-aware rules can't run here either.
	{
		files: ['package.json'],
		rules: {
			...disableTypeAwareRules,
			// lint-staged is a deliberate dev-only tool with no native equivalent.
			'depend/ban-dependencies': ['error', { allowed: ['lint-staged'] }],
		},
	},

	// Prettier: turn off formatting-related lint rules (must be last).
	prettier,
);

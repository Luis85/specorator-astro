/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
	forbidden: [
		{
			name: 'no-circular',
			severity: 'error',
			comment: 'Circular dependencies make the graph hard to reason about.',
			from: {},
			to: { circular: true },
		},
		{
			name: 'no-orphans',
			severity: 'warn',
			comment: 'Orphan modules are usually dead code.',
			from: { orphan: true, pathNot: ['\\.d\\.ts$'] },
			to: {},
		},
		{
			name: 'core-stays-pure',
			severity: 'error',
			comment: 'core/ must not depend on adapters/ or main.ts (ports-and-adapters seam).',
			from: { path: '^src/core/' },
			to: { path: '^src/(adapters/|main\\.ts)' },
		},
	],
	options: {
		doNotFollow: { path: 'node_modules' },
		tsConfig: { fileName: 'tsconfig.json' },
		tsPreCompilationDeps: true,
	},
};

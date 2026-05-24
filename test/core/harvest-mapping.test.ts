import { describe, expect, it } from 'vitest';
import {
	buildViewSnapshot,
	mapEntry,
	mapGroups,
	mapValue,
	mapViewProperties,
	normalizeGroupKey,
	selectViewConfig,
	type HarvestedConfig,
	type HarvestedEntry,
	type HarvestedGroup,
	type HarvestedValue,
} from '../../src/core/domain/harvest-mapping';
import type { BasesPropertyId, ResolvedTarget } from '../../src/core/domain/types';

/**
 * In-memory fakes for the structural Bases inputs the pure mapper consumes.
 * These duck-type `obsidian.Value`/`BasesEntry`/etc. so the mapper is tested
 * with zero `obsidian` import (TEST-2).
 */

/** A scalar `Value` (`PrimitiveValue<T>`): exposes `data` + `toString`. */
function primitive(data: string | number | boolean): HarvestedValue {
	return {
		data,
		isEmpty: () => false,
		toString: () => String(data),
	};
}

/** A string-only `Value` (e.g. a formula/date) with no wrapped scalar. */
function stringValue(text: string): HarvestedValue {
	return {
		isEmpty: () => text === '',
		toString: () => text,
	};
}

/** A `ListValue` exposing `getValues()`. */
function listValue(...elements: HarvestedValue[]): HarvestedValue {
	return {
		isEmpty: () => elements.length === 0,
		toString: () => elements.map((e) => e.toString()).join(', '),
		getValues: () => elements,
	};
}

/** An empty `Value` (`NullValue`-like). */
function emptyValue(): HarvestedValue {
	return {
		isEmpty: () => true,
		toString: () => '',
	};
}

function entry(
	path: string,
	basename: string,
	values: Record<string, HarvestedValue | null>,
): HarvestedEntry {
	return {
		file: { path, basename },
		getValue: (propertyId) => values[propertyId] ?? null,
	};
}

function config(
	name: string,
	order: BasesPropertyId[],
	displayNames: Record<string, string> = {},
): HarvestedConfig {
	return {
		name,
		getOrder: () => order,
		getDisplayName: (propertyId) => displayNames[propertyId] ?? propertyId,
	};
}

describe('mapValue', () => {
	it('maps null to null', () => {
		expect(mapValue(null)).toBeNull();
	});

	it('maps an empty value to null', () => {
		expect(mapValue(emptyValue())).toBeNull();
	});

	it('preserves a wrapped number scalar', () => {
		expect(mapValue(primitive(12.5))).toBe(12.5);
	});

	it('preserves a wrapped boolean scalar', () => {
		expect(mapValue(primitive(true))).toBe(true);
		expect(mapValue(primitive(false))).toBe(false);
	});

	it('stringifies a string primitive (does not pass the raw string through the scalar branch only)', () => {
		expect(mapValue(primitive('Dune'))).toBe('Dune');
	});

	it('falls back to toString for a value with no wrapped scalar', () => {
		expect(mapValue(stringValue('2026-05-24'))).toBe('2026-05-24');
	});

	it('maps a list value to a string array', () => {
		expect(mapValue(listValue(stringValue('fiction'), stringValue('sci-fi')))).toEqual([
			'fiction',
			'sci-fi',
		]);
	});

	it('drops empty elements from a list value', () => {
		expect(mapValue(listValue(stringValue('a'), emptyValue(), stringValue('b')))).toEqual([
			'a',
			'b',
		]);
	});

	it('maps an empty list to an empty array', () => {
		// An empty list reports isEmpty() === true, so it normalizes to null.
		expect(mapValue(listValue())).toBeNull();
	});

	it('surfaces an ErrorValue as its message string rather than dropping it', () => {
		// Bases returns ErrorValues from getValue() like any other Value; their
		// toString() is the error message.
		const errorValue: HarvestedValue = {
			isEmpty: () => false,
			toString: () => 'Error: invalid formula',
		};
		expect(mapValue(errorValue)).toBe('Error: invalid formula');
	});
});

describe('normalizeGroupKey', () => {
	it('maps an absent key to null (ungrouped view)', () => {
		expect(normalizeGroupKey(undefined)).toBeNull();
	});

	it('maps an empty key to null (missing groupBy property)', () => {
		expect(normalizeGroupKey(emptyValue())).toBeNull();
	});

	it('maps a present scalar key to its string form', () => {
		expect(normalizeGroupKey(stringValue('Reading'))).toBe('Reading');
	});

	it('coerces a numeric key to a string', () => {
		expect(normalizeGroupKey(primitive(2026))).toBe('2026');
	});

	it('joins a list key into a single string label', () => {
		expect(normalizeGroupKey(listValue(stringValue('a'), stringValue('b')))).toBe('a, b');
	});
});

describe('mapEntry', () => {
	const order: BasesPropertyId[] = ['file.name', 'note.author', 'formula.ppu'];
	const resolveRoute = () => '/books/dune';

	it('reads every property id in order into values', () => {
		const e = entry('Books/Dune.md', 'Dune', {
			'file.name': stringValue('Dune'),
			'note.author': stringValue('Frank Herbert'),
			'formula.ppu': primitive(12.5),
		});
		expect(mapEntry(e, order, resolveRoute)).toEqual({
			path: 'Books/Dune.md',
			basename: 'Dune',
			route: '/books/dune',
			values: {
				'file.name': 'Dune',
				'note.author': 'Frank Herbert',
				'formula.ppu': 12.5,
			},
		});
	});

	it('maps a property absent from the entry to null', () => {
		const e = entry('Books/Dune.md', 'Dune', { 'file.name': stringValue('Dune') });
		expect(mapEntry(e, order, resolveRoute).values).toEqual({
			'file.name': 'Dune',
			'note.author': null,
			'formula.ppu': null,
		});
	});

	it('uses the resolved route from the resolver', () => {
		const e = entry('Notes/A.md', 'A', {});
		expect(mapEntry(e, [], (x) => `/x/${x.file.basename.toLowerCase()}`).route).toBe('/x/a');
	});
});

describe('mapGroups', () => {
	const order: BasesPropertyId[] = ['file.name'];
	const resolveRoute = (e: HarvestedEntry) => `/books/${e.file.basename.toLowerCase()}`;

	it('preserves group and entry order without re-sorting', () => {
		const groups: HarvestedGroup[] = [
			{
				key: stringValue('Reading'),
				entries: [
					entry('Books/Dune.md', 'Dune', { 'file.name': stringValue('Dune') }),
					entry('Books/Hyperion.md', 'Hyperion', {
						'file.name': stringValue('Hyperion'),
					}),
				],
			},
			{
				key: stringValue('Done'),
				entries: [
					entry('Books/Sapiens.md', 'Sapiens', { 'file.name': stringValue('Sapiens') }),
				],
			},
		];
		const result = mapGroups(groups, order, resolveRoute);
		expect(result).toEqual([
			{
				key: 'Reading',
				entries: [
					{
						path: 'Books/Dune.md',
						basename: 'Dune',
						route: '/books/dune',
						values: { 'file.name': 'Dune' },
					},
					{
						path: 'Books/Hyperion.md',
						basename: 'Hyperion',
						route: '/books/hyperion',
						values: { 'file.name': 'Hyperion' },
					},
				],
			},
			{
				key: 'Done',
				entries: [
					{
						path: 'Books/Sapiens.md',
						basename: 'Sapiens',
						route: '/books/sapiens',
						values: { 'file.name': 'Sapiens' },
					},
				],
			},
		]);
	});

	it('normalizes the single empty-key group of an ungrouped view to key null', () => {
		const groups: HarvestedGroup[] = [
			{
				key: emptyValue(),
				entries: [entry('Books/Dune.md', 'Dune', { 'file.name': stringValue('Dune') })],
			},
		];
		expect(mapGroups(groups, order, resolveRoute)[0]?.key).toBeNull();
	});
});

describe('mapViewProperties', () => {
	it('mirrors the order and resolves a display name per property', () => {
		const cfg = config('Reading list', ['file.name', 'note.author'], {
			'file.name': 'Title',
			'note.author': 'Author',
		});
		expect(mapViewProperties(cfg)).toEqual({
			order: ['file.name', 'note.author'],
			properties: {
				'file.name': { displayName: 'Title' },
				'note.author': { displayName: 'Author' },
			},
		});
	});

	it('falls back to the property id when no display name is configured', () => {
		const cfg = config('v', ['formula.ppu']);
		expect(mapViewProperties(cfg).properties['formula.ppu']).toEqual({
			displayName: 'formula.ppu',
		});
	});
});

describe('selectViewConfig', () => {
	it('matches the named view and mirrors its type', () => {
		const base = {
			views: [
				{ type: 'table', name: 'Table' },
				{ type: 'cards', name: 'Reading list' },
			],
		};
		expect(selectViewConfig(base, 'Reading list')).toEqual({ type: 'cards' });
	});

	it('mirrors a string groupBy as ASC', () => {
		const base = { views: [{ type: 'cards', name: 'v', groupBy: 'note.status' }] };
		expect(selectViewConfig(base, 'v')).toEqual({
			type: 'cards',
			groupBy: { property: 'note.status', direction: 'ASC' },
		});
	});

	it('mirrors an object groupBy with its direction', () => {
		const base = {
			views: [
				{ type: 'list', name: 'v', groupBy: { property: 'note.year', direction: 'DESC' } },
			],
		};
		expect(selectViewConfig(base, 'v')).toEqual({
			type: 'list',
			groupBy: { property: 'note.year', direction: 'DESC' },
		});
	});

	it('defaults an object groupBy without a direction to ASC', () => {
		const base = { views: [{ type: 'table', name: 'v', groupBy: { property: 'note.x' } }] };
		expect(selectViewConfig(base, 'v').groupBy).toEqual({
			property: 'note.x',
			direction: 'ASC',
		});
	});

	it('ignores a groupBy object with no property', () => {
		const base = { views: [{ type: 'table', name: 'v', groupBy: { direction: 'DESC' } }] };
		expect(selectViewConfig(base, 'v')).toEqual({ type: 'table' });
	});

	it('falls back to the first view when the name does not match', () => {
		const base = {
			views: [
				{ type: 'cards', name: 'A' },
				{ type: 'list', name: 'B' },
			],
		};
		expect(selectViewConfig(base, 'missing')).toEqual({ type: 'cards' });
	});

	it('defaults to table when the type is unsupported (e.g. map) or absent', () => {
		expect(selectViewConfig({ views: [{ type: 'map', name: 'v' }] }, 'v')).toEqual({
			type: 'table',
		});
		expect(selectViewConfig({ views: [{ name: 'v' }] }, 'v')).toEqual({ type: 'table' });
	});

	it('defaults to table when the base declares no views', () => {
		expect(selectViewConfig({}, 'v')).toEqual({ type: 'table' });
		expect(selectViewConfig({ views: [] }, 'v')).toEqual({ type: 'table' });
	});
});

describe('buildViewSnapshot', () => {
	const target: ResolvedTarget = {
		basePath: 'Books/books.base',
		viewName: 'Reading list',
		route: '/books',
		component: 'cards',
		layout: 'BaseLayout',
	};

	it('assembles a complete snapshot mirroring the chosen view config', () => {
		const cfg = config('Reading list', ['file.name', 'note.author'], {
			'file.name': 'Title',
			'note.author': 'Author',
		});
		const groupedData: HarvestedGroup[] = [
			{
				key: stringValue('Reading'),
				entries: [
					entry('Books/Dune.md', 'Dune', {
						'file.name': stringValue('Dune'),
						'note.author': stringValue('Frank Herbert'),
					}),
				],
			},
		];
		const snapshot = buildViewSnapshot({
			target,
			config: cfg,
			groupedData,
			viewType: 'cards',
			groupBy: { property: 'note.status', direction: 'ASC' },
			generatedAt: '2026-05-24T00:00:00.000Z',
		});

		expect(snapshot).toEqual({
			baseId: 'books',
			route: '/books',
			source: { kind: 'file', path: 'Books/books.base' },
			view: {
				type: 'cards',
				name: 'Reading list',
				order: ['file.name', 'note.author'],
				groupBy: { property: 'note.status', direction: 'ASC' },
			},
			render: { component: 'cards', layout: 'BaseLayout' },
			groups: [
				{
					key: 'Reading',
					entries: [
						{
							path: 'Books/Dune.md',
							basename: 'Dune',
							route: '/books/dune',
							values: { 'file.name': 'Dune', 'note.author': 'Frank Herbert' },
						},
					],
				},
			],
			generatedAt: '2026-05-24T00:00:00.000Z',
		});
	});

	it('omits groupBy when the view is ungrouped', () => {
		const snapshot = buildViewSnapshot({
			target,
			config: config('Table', ['file.name']),
			groupedData: [],
			viewType: 'table',
			generatedAt: '2026-05-24T00:00:00.000Z',
		});
		expect(snapshot.view).not.toHaveProperty('groupBy');
		expect(snapshot.groups).toEqual([]);
	});

	it('derives baseId from the base file basename', () => {
		const snapshot = buildViewSnapshot({
			target: { ...target, basePath: 'Library/reading-log.base' },
			config: config('v', []),
			groupedData: [],
			viewType: 'list',
			generatedAt: '2026-05-24T00:00:00.000Z',
		});
		expect(snapshot.baseId).toBe('reading-log');
	});

	it('derives per-entry routes by slugifying the basename under the view route', () => {
		const snapshot = buildViewSnapshot({
			target,
			config: config('v', []),
			groupedData: [
				{
					entries: [
						entry(
							'Books/The Left Hand of Darkness.md',
							'The Left Hand of Darkness',
							{},
						),
					],
				},
			],
			viewType: 'cards',
			generatedAt: '2026-05-24T00:00:00.000Z',
		});
		expect(snapshot.groups[0]?.entries[0]?.route).toBe('/books/the-left-hand-of-darkness');
	});

	it('handles a root view route and a non-sluggable basename', () => {
		const snapshot = buildViewSnapshot({
			target: { ...target, route: '/' },
			config: config('v', []),
			groupedData: [{ entries: [entry('Notes/!!!.md', '!!!', {})] }],
			viewType: 'list',
			generatedAt: '2026-05-24T00:00:00.000Z',
		});
		// Root route + a basename that slugifies to empty -> '/entry'.
		expect(snapshot.groups[0]?.entries[0]?.route).toBe('/entry');
	});
});

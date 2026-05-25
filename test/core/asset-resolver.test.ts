import { describe, expect, it } from 'vitest';
import {
	AssetResolver,
	PLACEHOLDER_ASSET_URL,
	decideAssetAvailability,
	isImageReference,
	missingAsset,
	normalizeReference,
} from '../../src/core/domain/asset-resolver';

describe('isImageReference', () => {
	it('flags plain vault-relative image paths', () => {
		expect(isImageReference('Attachments/cover.png')).toBe(true);
		expect(isImageReference('poster.JPG')).toBe(true);
		expect(isImageReference('icon.svg')).toBe(true);
	});

	it('flags an image embed/wikilink', () => {
		expect(isImageReference('![[cover.png]]')).toBe(true);
		expect(isImageReference('[[Films/poster.webp|alt]]')).toBe(true);
	});

	it('does not flag non-image text, links, or non-strings', () => {
		expect(isImageReference('Frank Herbert')).toBe(false);
		expect(isImageReference('doc.pdf')).toBe(false);
		expect(isImageReference('[[Some Note]]')).toBe(false);
		expect(isImageReference('')).toBe(false);
		expect(isImageReference(null)).toBe(false);
		expect(isImageReference(42)).toBe(false);
		expect(isImageReference(['a', 'b'])).toBe(false);
	});

	it('does not flag remote or already-public image URLs (not vault sources)', () => {
		expect(isImageReference('https://example.com/cover.png')).toBe(false);
		expect(isImageReference('//cdn.example.com/cover.png')).toBe(false);
		expect(isImageReference('data:image/png;base64,AAAA')).toBe(false);
		expect(isImageReference('/assets/cover.png')).toBe(false);
	});
});

describe('normalizeReference', () => {
	it('returns null for an empty or whitespace-only reference', () => {
		expect(normalizeReference('')).toBeNull();
		expect(normalizeReference('   ')).toBeNull();
		expect(normalizeReference('[[]]')).toBeNull();
	});

	it('passes a plain vault-relative path through unchanged', () => {
		expect(normalizeReference('Attachments/cover.png')).toBe('Attachments/cover.png');
	});

	it('strips an `![[embed]]` wrapper', () => {
		expect(normalizeReference('![[cover.png]]')).toBe('cover.png');
	});

	it('strips a `[[wikilink]]` wrapper', () => {
		expect(normalizeReference('[[Attachments/cover.png]]')).toBe('Attachments/cover.png');
	});

	it('drops an alias after `|` (`![[img.png|alt]]`)', () => {
		expect(normalizeReference('![[img.png|some alt text]]')).toBe('img.png');
	});

	it('drops a subpath/anchor after `#`', () => {
		expect(normalizeReference('![[doc.pdf#page=2]]')).toBe('doc.pdf');
	});

	it('normalizes backslashes, leading `./`, and leading slashes', () => {
		expect(normalizeReference('.\\Attachments\\cover.png')).toBe('Attachments/cover.png');
		expect(normalizeReference('/Attachments/cover.png')).toBe('Attachments/cover.png');
		expect(normalizeReference('./cover.png')).toBe('cover.png');
	});

	it('collapses duplicate slashes and drops `.` segments', () => {
		expect(normalizeReference('Attachments//sub/./cover.png')).toBe(
			'Attachments/sub/cover.png',
		);
	});
});

describe('AssetResolver', () => {
	it('resolves a plain image path to a stable public URL', () => {
		const resolver = new AssetResolver();
		expect(resolver.resolve('Attachments/cover.png')).toEqual({
			sourcePath: 'Attachments/cover.png',
			url: '/assets/cover.png',
		});
	});

	it('resolves an embed reference, stripping the wrapper and alias', () => {
		const resolver = new AssetResolver();
		expect(resolver.resolve('![[Films/Stalker poster.jpg|Stalker]]')).toEqual({
			sourcePath: 'Films/Stalker poster.jpg',
			url: '/assets/stalker-poster.jpg',
		});
	});

	it('returns null for an empty / non-asset reference', () => {
		const resolver = new AssetResolver();
		expect(resolver.resolve('')).toBeNull();
		expect(resolver.resolve('   ')).toBeNull();
	});

	it('dedupes: the same source always maps to the same URL', () => {
		const resolver = new AssetResolver();
		const first = resolver.resolve('Attachments/cover.png');
		const again = resolver.resolve('![[Attachments/cover.png]]'); // same source, wrapped
		expect(first).toEqual(again);
		// Only one manifest entry despite two references.
		expect(resolver.manifest()).toEqual([
			{ source: 'Attachments/cover.png', url: '/assets/cover.png' },
		]);
	});

	it('disambiguates two distinct sources that share a basename', () => {
		const resolver = new AssetResolver();
		const a = resolver.resolve('Books/cover.png');
		const b = resolver.resolve('Films/cover.png');
		expect(a?.url).toBe('/assets/cover.png');
		expect(b?.url).toBe('/assets/cover-1.png');
		// Distinct sources, distinct URLs — collision resolved.
		expect(a?.url).not.toBe(b?.url);
		expect(resolver.manifest()).toEqual([
			{ source: 'Books/cover.png', url: '/assets/cover.png' },
			{ source: 'Films/cover.png', url: '/assets/cover-1.png' },
		]);
	});

	it('disambiguates a third collision with a higher numeric suffix', () => {
		const resolver = new AssetResolver();
		resolver.resolve('A/x.png');
		resolver.resolve('B/x.png');
		expect(resolver.resolve('C/x.png')?.url).toBe('/assets/x-2.png');
	});

	it('produces a percent-safe URL segment from awkward basenames', () => {
		const resolver = new AssetResolver();
		// Spaces, punctuation, and case collapse to a single `-`; the extension is
		// kept but lowercased for a stable, percent-safe segment.
		expect(resolver.resolve('Att/My Cover (final)!.PNG')?.url).toBe(
			'/assets/my-cover-final.png',
		);
	});

	it('uses a custom prefix when constructed with one', () => {
		const resolver = new AssetResolver('media');
		expect(resolver.resolve('cover.png')?.url).toBe('/media/cover.png');
	});

	it('falls back to `asset` when the stem is entirely unsafe characters', () => {
		const resolver = new AssetResolver();
		// A basename whose stem is all stripped (e.g. only spaces/symbols) before
		// the extension falls back to `asset` rather than an empty segment.
		expect(resolver.resolve('Att/   .png')?.url).toBe('/assets/asset.png');
	});

	it('handles an extensionless reference (no dot) without inventing one', () => {
		const resolver = new AssetResolver();
		const a = resolver.resolve('Attachments/cover');
		expect(a).toEqual({ sourcePath: 'Attachments/cover', url: '/assets/cover' });
		// A second extensionless collision still disambiguates with a suffix.
		expect(resolver.resolve('Other/cover')?.url).toBe('/assets/cover-1');
	});

	it('treats a leading-dot basename as having no stem/extension split', () => {
		const resolver = new AssetResolver();
		// `.keep` has its dot at index 0, so it is not split into stem+extension;
		// the whole name is the stem (the `.` is kept by the safe-segment rule).
		expect(resolver.resolve('Attachments/.keep')?.url).toBe('/assets/.keep');
	});

	it('keeps the manifest in first-seen order', () => {
		const resolver = new AssetResolver();
		resolver.resolve('b.png');
		resolver.resolve('a.png');
		resolver.resolve('b.png'); // dedupe — no new entry
		expect(resolver.manifest().map((m) => m.source)).toEqual(['b.png', 'a.png']);
	});
});

describe('decideAssetAvailability (graceful degradation, FR-16)', () => {
	it('returns null when the asset exists and is within size', () => {
		expect(
			decideAssetAvailability({
				sourcePath: 'Attachments/cover.png',
				exists: true,
				sizeBytes: 1000,
				maxSizeBytes: 10_000,
			}),
		).toBeNull();
	});

	it('returns null when the asset exists and no size cap is set', () => {
		expect(decideAssetAvailability({ sourcePath: 'a.png', exists: true })).toBeNull();
	});

	it('degrades a missing asset to a placeholder + warning (never fatal)', () => {
		const result = decideAssetAvailability({
			sourcePath: 'Attachments/gone.png',
			exists: false,
		});
		expect(result).not.toBeNull();
		expect(result?.reason).toBe('not-found');
		expect(result?.placeholderUrl).toBe(PLACEHOLDER_ASSET_URL);
		expect(result?.warning).toContain('Attachments/gone.png');
		expect(result?.warning).toContain('placeholder');
	});

	it('degrades an oversized asset to a placeholder + warning', () => {
		const result = decideAssetAvailability({
			sourcePath: 'Attachments/huge.png',
			exists: true,
			sizeBytes: 50_000,
			maxSizeBytes: 10_000,
		});
		expect(result?.reason).toBe('too-large');
		expect(result?.placeholderUrl).toBe(PLACEHOLDER_ASSET_URL);
		expect(result?.warning).toContain('huge.png');
		expect(result?.warning).toContain('50000');
	});

	it('does not flag size when the size is unknown even with a cap', () => {
		expect(
			decideAssetAvailability({ sourcePath: 'a.png', exists: true, maxSizeBytes: 10 }),
		).toBeNull();
	});
});

describe('missingAsset', () => {
	it('always returns the placeholder degradation for a missing source', () => {
		const result = missingAsset('Attachments/gone.png');
		expect(result.reason).toBe('not-found');
		expect(result.placeholderUrl).toBe(PLACEHOLDER_ASSET_URL);
		expect(result.warning).toContain('Attachments/gone.png');
	});
});

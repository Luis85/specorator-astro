/*
 * specorator-template-version: 1
 *
 * Small display helpers shared by the table/cards/list view components. The
 * snapshot carries property ids in `view.order` (e.g. `note.author`,
 * `file.name`, `formula.ppu`); these turn an id into a legible column/field
 * label and render a `CellValue` as text. Kept deliberately simple — richer
 * per-property `displayName` metadata is a later concern (C8/C11).
 */
import type { CellValue } from '../../content/schema';

/**
 * Humanize a Bases property id into a column/field label. Drops the kind prefix
 * (`note.` / `file.` / `formula.`), splits camelCase and separators, and
 * capitalizes — `note.author` → `Author`, `file.name` → `Name`,
 * `formula.pricePerUnit` → `Price Per Unit`.
 */
export function getDisplayName(propertyId: string): string {
	const tail = propertyId.includes('.')
		? propertyId.slice(propertyId.indexOf('.') + 1)
		: propertyId;
	const words = tail
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.replace(/[_-]+/g, ' ')
		.trim()
		.split(/\s+/)
		.filter(Boolean);
	if (words.length === 0) return propertyId;
	return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/** Render a normalized cell value as display text (arrays join with `, `). */
export function formatCell(value: CellValue): string {
	if (value === null || value === undefined) return '';
	if (Array.isArray(value)) return value.join(', ');
	if (typeof value === 'boolean') return value ? 'Yes' : 'No';
	return String(value);
}

/**
 * The single public image URL for an image-typed property value, or `null` when
 * there is nothing to render (FR-16). The asset pipeline rewrites image-typed
 * values to a public URL string (or a placeholder URL for a missing asset); a
 * list value uses its first element. Non-string/empty values yield `null`.
 */
export function imageUrl(value: CellValue): string | null {
	const raw = Array.isArray(value) ? (value[0] ?? null) : value;
	if (typeof raw !== 'string') return null;
	const trimmed = raw.trim();
	return trimmed === '' ? null : trimmed;
}

/** Whether a property id is flagged as an image for this view (FR-16). */
export function isImageProperty(propertyId: string, imageProperties?: string[]): boolean {
	return imageProperties?.includes(propertyId) ?? false;
}

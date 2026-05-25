/*
 * specorator-template-version: 1
 *
 * Detail-page body renderer (FR-21, D8; DESIGN §5.7, §6). Turns an entry's
 * markdown `body.content` into HTML at **core fidelity**: GitHub-flavored
 * markdown + Obsidian **callouts**, with `[[wikilinks]]`/`![[embeds]]` ALREADY
 * resolved to routes/asset URLs by the plugin before the snapshot is written
 * (DESIGN §5.7 — link resolution happens pre-render in core, not here).
 *
 * Pipeline: remark-parse → remark-gfm → (callout transform) → remark-rehype
 * (allowing raw HTML through) → rehype-raw → rehype-stringify. Block refs,
 * transclusions, and Dataview are explicitly **out of scope** (D8): the plugin
 * leaves them as plain text / fenced code, and this renderer just passes that
 * through — it never throws on them.
 *
 * Kept synchronous-friendly: the unified processor runs once per build per
 * entry, off the static `getStaticPaths` render path (`output: 'static'`).
 */
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeStringify from 'rehype-stringify';
import { visit } from 'unist-util-visit';
import type { Root, Blockquote, Paragraph, Text } from 'mdast';

/** Obsidian callout opener: `> [!type]` or `> [!type]+ Optional title`. */
const CALLOUT = /^\[!(\w[\w-]*)\]([+-]?)(?:\s+(.*))?$/;

/**
 * Remark transform turning an Obsidian callout blockquote into a
 * `<aside class="sp-callout" data-callout="type">` with a title row and body.
 * A blockquote whose first line is `[!type] …` is a callout; anything else is a
 * normal blockquote and is left untouched (graceful — never throws).
 */
function remarkCallouts() {
	return (tree: Root): void => {
		visit(tree, 'blockquote', (node: Blockquote) => {
			const first = node.children[0];
			if (first === undefined || first.type !== 'paragraph') {
				return;
			}
			const paragraph = first as Paragraph;
			const lead = paragraph.children[0];
			if (lead === undefined || lead.type !== 'text') {
				return;
			}
			const text = lead as Text;
			const lines = text.value.split('\n');
			const match = CALLOUT.exec(lines[0] ?? '');
			if (match === null) {
				return;
			}

			const calloutType = match[1].toLowerCase();
			const title = (match[3] ?? '').trim() || titleCase(calloutType);

			// Drop the `[!type] …` opener line from the paragraph's leading text,
			// keeping any same-paragraph body that followed it on the next lines.
			const rest = lines.slice(1).join('\n');
			text.value = rest;
			if (rest === '' && paragraph.children.length === 1) {
				node.children.shift();
			}

			// Mark the blockquote as a callout via hast properties (rendered by
			// remark-rehype). A leading title paragraph carries the callout label.
			const data = (node.data ??= {});
			data.hName = 'aside';
			data.hProperties = { className: ['sp-callout'], 'data-callout': calloutType };
			node.children.unshift({
				type: 'paragraph',
				data: { hProperties: { className: ['sp-callout-title'] } },
				children: [{ type: 'text', value: title }],
			} as Paragraph);
		});
	};
}

/** Title-case a callout type id for the default title (`note` → `Note`). */
function titleCase(id: string): string {
	return id.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

const processor = unified()
	.use(remarkParse)
	.use(remarkGfm)
	.use(remarkCallouts)
	.use(remarkRehype, { allowDangerousHtml: true })
	.use(rehypeRaw)
	.use(rehypeStringify, { allowDangerousHtml: true });

/**
 * Render markdown body content to an HTML string. Never throws on Obsidian-only
 * syntax (block refs / transclusions / Dataview) — they pass through as text or
 * fenced code (D8). Returns `''` for empty/whitespace input.
 */
export function renderMarkdown(content: string): string {
	if (content.trim() === '') {
		return '';
	}
	return String(processor.processSync(content));
}

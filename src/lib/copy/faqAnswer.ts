export type FaqAnswerFormat = 'markdown' | 'html';

export type FaqSegment =
	| { type: 'text'; text: string }
	| { type: 'bold'; text: string }
	| {
			type: 'link';
			text: string;
			href: string;
			external: boolean;
			internalAction?: 'bugReport';
		};

/** [label](https://...), [label](mailto:...), or [label](app:feedback) to open the bug/feedback dialog. */
const LINK_PREFIX_RE =
	/^\[([^\]]*)\]\(((?:https?:\/\/|mailto:)[^)\s]+|app:feedback)\)/;

export function faqAnswerParagraphs(answer: string): string[] {
	return answer
		.trim()
		.split(/\n{2,}/)
		.map((p) => p.trim())
		.filter(Boolean);
}

/** Blockquote paragraph: any non-empty line may start with `> ` (markdown-style). */
const BLOCKQUOTE_LINE_RE = /^\s*>\s?/;

/**
 * If the paragraph is a block quote (first non-empty line starts with `>`), returns
 * `blockquote` and the body with `> ` stripped from each line. Otherwise the paragraph
 * is unchanged and kind is `p`.
 */
export function faqParagraphBlock(
	paragraph: string
): { kind: 'p' | 'blockquote'; text: string } {
	const lines = paragraph.split('\n');
	const firstNonEmpty = lines.find((l) => l.trim() !== '');
	if (!firstNonEmpty || !BLOCKQUOTE_LINE_RE.test(firstNonEmpty)) {
		return { kind: 'p', text: paragraph };
	}
	const stripped = lines
		.map((line) => (line.trim() === '' ? line : line.replace(BLOCKQUOTE_LINE_RE, '')))
		.join('\n');
	return { kind: 'blockquote', text: stripped.trim() };
}

/**
 * FAQ YAML is trusted in-repo copy. Segments avoid `{@html}` while supporting **bold**,
 * [label](url) / [label](mailto:), and [label](app:feedback) for the in-app feedback form.
 */
export function parseFaqParagraph(paragraph: string, format: FaqAnswerFormat): FaqSegment[] {
	if (format === 'html') {
		return [{ type: 'text', text: paragraph }];
	}
	const segments: FaqSegment[] = [];
	let i = 0;
	while (i < paragraph.length) {
		if (paragraph.startsWith('**', i)) {
			const end = paragraph.indexOf('**', i + 2);
			if (end !== -1) {
				segments.push({ type: 'bold', text: paragraph.slice(i + 2, end) });
				i = end + 2;
				continue;
			}
		}
		if (paragraph[i] === '[') {
			const rest = paragraph.slice(i);
			const m = rest.match(LINK_PREFIX_RE);
			if (m) {
				const href = m[2];
				if (href === 'app:feedback') {
					segments.push({
						type: 'link',
						text: m[1],
						href,
						external: false,
						internalAction: 'bugReport'
					});
				} else {
					segments.push({
						type: 'link',
						text: m[1],
						href,
						external: href.startsWith('http')
					});
				}
				i += m[0].length;
				continue;
			}
		}
		let next = paragraph.length;
		const bi = paragraph.indexOf('**', i);
		if (bi !== -1) next = Math.min(next, bi);
		const bki = paragraph.indexOf('[', i);
		if (bki !== -1) next = Math.min(next, bki);
		if (next === i) {
			segments.push({ type: 'text', text: paragraph[i] });
			i += 1;
			continue;
		}
		segments.push({ type: 'text', text: paragraph.slice(i, next) });
		i = next;
	}
	return segments;
}

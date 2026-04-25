export type FaqAnswerFormat = 'markdown' | 'html';

export type FaqSegment =
	| { type: 'text'; text: string }
	| { type: 'bold'; text: string }
	| { type: 'link'; text: string; href: string; external: boolean };

const LINK_PREFIX_RE = /^\[([^\]]*)\]\(((?:https?:\/\/|mailto:)[^)\s]+)\)/;

export function faqAnswerParagraphs(answer: string): string[] {
	return answer
		.trim()
		.split(/\n{2,}/)
		.map((p) => p.trim())
		.filter(Boolean);
}

/**
 * FAQ YAML is trusted in-repo copy. Segments avoid `{@html}` while supporting **bold** and [label](url) / [label](mailto:).
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
				segments.push({
					type: 'link',
					text: m[1],
					href: m[2],
					external: m[2].startsWith('http')
				});
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

import { fetchJson, joinUrl } from '../release';
import { validateDetailManifest } from './release';
import {
	ProminenceFormatError,
	type NormalizedAuthorDetail,
	type NormalizedDetailShard,
	type ProminenceDetailManifest,
	type ProminenceDetailRow,
	type ProminenceDetailShard,
	type ProminenceManifest,
	type ProminenceRecognitionReceiptTuple,
	type ProminenceRecognitionTierTuple
} from './types';

export const DETAIL_COLUMNS = [
	'peak_rank',
	'peak_weights',
	'catalogue_years',
	'genres',
	'books',
	'recognition'
] as const;

export const DETAIL_WEIGHT_TOLERANCE = 0.000001;

const ULID_PATTERN = /^[0-7][0-9ABCDEFGHJKMNPQRSTVWXYZ]{25}$/i;

export interface DetailRepositoryContext {
	base: string;
	webRoot: string;
	manifest: ProminenceManifest;
	populationCount: number;
}

function fail(message: string): never {
	throw new ProminenceFormatError(message);
}

function finite(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

function integer(value: unknown, label: string, minimum?: number, maximum?: number): number {
	if (
		typeof value !== 'number' ||
		!Number.isInteger(value) ||
		(minimum !== undefined && value < minimum) ||
		(maximum !== undefined && value > maximum)
	)
		fail(
			`${label} must be an integer${minimum !== undefined ? ` at least ${minimum}` : ''}${maximum !== undefined ? ` and at most ${maximum}` : ''}.`
		);
	return value;
}

function stringValue(value: unknown, label: string): string {
	if (typeof value !== 'string' || !value.trim()) fail(`${label} must be a non-empty string.`);
	return value.trim();
}

function exactColumns(columns: unknown): columns is string[] {
	return (
		Array.isArray(columns) &&
		columns.length === DETAIL_COLUMNS.length &&
		columns.every((column, index) => column === DETAIL_COLUMNS[index])
	);
}

function normalizeYears(value: unknown, rowLabel: string): [number, number] | null {
	if (value === null) return null;
	if (!Array.isArray(value) || value.length !== 2)
		fail(`${rowLabel}.catalogue_years must be null or a two-integer range.`);
	const minimum = integer(value[0], `${rowLabel}.catalogue_years minimum`, undefined);
	const maximum = integer(value[1], `${rowLabel}.catalogue_years maximum`, undefined);
	if (minimum > maximum) fail(`${rowLabel}.catalogue_years minimum cannot exceed maximum.`);
	return [minimum, maximum];
}

function normalizeGenres(value: unknown, rowLabel: string): string[] {
	if (!Array.isArray(value)) fail(`${rowLabel}.genres must be an array.`);
	const genres: string[] = [];
	const seen = new Set<string>();
	for (const rawGenre of value) {
		if (typeof rawGenre !== 'string') fail(`${rowLabel}.genres contains a non-string value.`);
		const genre = rawGenre.trim();
		if (!genre || seen.has(genre)) continue;
		seen.add(genre);
		genres.push(genre);
	}
	if (genres.length > 2) fail(`${rowLabel}.genres contains more than two unique genres.`);
	return genres;
}

function normalizeBooks(
	value: unknown,
	rowLabel: string,
	bookLimit: number
): ProminenceDetailRow[4] {
	if (!Array.isArray(value) || value.length < 1 || value.length > bookLimit)
		fail(`${rowLabel}.books must contain between 1 and ${bookLimit} books.`);
	const books: ProminenceDetailRow[4] = [];
	const seen = new Set<string>();
	for (let index = 0; index < value.length; index++) {
		const rawBook = value[index];
		if (!Array.isArray(rawBook) || rawBook.length !== 2)
			fail(`${rowLabel}.books[${index}] must contain a book ULID and title.`);
		const bookId = stringValue(rawBook[0], `${rowLabel}.books[${index}] ULID`).toUpperCase();
		if (!ULID_PATTERN.test(bookId)) fail(`${rowLabel}.books[${index}] contains an invalid ULID.`);
		if (seen.has(bookId)) fail(`${rowLabel}.books contains a duplicate book.`);
		seen.add(bookId);
		books.push([bookId, stringValue(rawBook[1], `${rowLabel}.books[${index}] title`)]);
	}
	return books;
}

function normalizeRecognition(
	value: unknown,
	rowLabel: string,
	recordLimit: number
): ProminenceDetailRow[5] {
	if (!Array.isArray(value)) fail(`${rowLabel}.recognition must be an array of tier groups.`);
	const groups: ProminenceRecognitionTierTuple[] = [];
	const seenTiers = new Set<number>();
	let totalRecords = 0;
	for (let groupIndex = 0; groupIndex < value.length; groupIndex++) {
		const rawGroup = value[groupIndex];
		if (!Array.isArray(rawGroup) || rawGroup.length !== 2)
			fail(`${rowLabel}.recognition[${groupIndex}] must contain a tier and receipts.`);
		const tier = integer(rawGroup[0], `${rowLabel}.recognition[${groupIndex}] tier`, 1, 5);
		if (seenTiers.has(tier)) fail(`${rowLabel}.recognition contains a duplicate tier.`);
		seenTiers.add(tier);
		if (!Array.isArray(rawGroup[1]))
			fail(`${rowLabel}.recognition[${groupIndex}] receipts must be an array.`);
		const receipts: ProminenceRecognitionReceiptTuple[] = [];
		for (let receiptIndex = 0; receiptIndex < rawGroup[1].length; receiptIndex++) {
			const rawReceipt = rawGroup[1][receiptIndex];
			if (!Array.isArray(rawReceipt) || rawReceipt.length !== 4)
				fail(
					`${rowLabel}.recognition[${groupIndex}][${receiptIndex}] must contain work, award, year, and status.`
				);
			const year =
				rawReceipt[2] === null
					? null
					: integer(
							rawReceipt[2],
							`${rowLabel}.recognition[${groupIndex}][${receiptIndex}] year`,
							undefined
						);
			const status = stringValue(
				rawReceipt[3],
				`${rowLabel}.recognition[${groupIndex}][${receiptIndex}] status`
			).toLowerCase();
			receipts.push([
				stringValue(rawReceipt[0], `${rowLabel}.recognition[${groupIndex}][${receiptIndex}] work`),
				stringValue(rawReceipt[1], `${rowLabel}.recognition[${groupIndex}][${receiptIndex}] award`),
				year,
				status
			]);
			totalRecords += 1;
			if (totalRecords > recordLimit)
				fail(`${rowLabel}.recognition contains more than ${recordLimit} records.`);
		}
		groups.push([tier, receipts]);
	}
	return groups;
}

function normalizeRow(
	row: unknown,
	rowIndex: number,
	start: number,
	manifest: ProminenceManifest
): NormalizedAuthorDetail {
	if (!Array.isArray(row) || row.length !== DETAIL_COLUMNS.length)
		fail(`Detail row ${rowIndex} must contain ${DETAIL_COLUMNS.length} fields.`);
	const rowLabel = `Detail row ${rowIndex}`;
	const details = manifest.details;
	const peakRank = integer(row[0], `${rowLabel}.peak_rank`, 1, details.author_count);
	if (!Array.isArray(row[1]) || row[1].length !== manifest.model.features.length)
		fail(
			`${rowLabel}.peak_weights must contain ${manifest.model.features.length} feature weights.`
		);
	const peakWeights = row[1].map((weight, index) => {
		if (!finite(weight) || weight < 0)
			fail(`${rowLabel}.peak_weights[${index}] must be finite and nonnegative.`);
		return weight;
	});
	const weightTotal = peakWeights.reduce((sum, weight) => sum + weight, 0);
	if (Math.abs(weightTotal - 1) > DETAIL_WEIGHT_TOLERANCE)
		fail(`${rowLabel}.peak_weights must sum to 1 within ${DETAIL_WEIGHT_TOLERANCE}.`);
	const books = normalizeBooks(row[4], rowLabel, details.book_limit);
	const recognition = normalizeRecognition(row[5], rowLabel, details.recognition_record_limit);
	return {
		populationIndex: start + rowIndex,
		peakRank,
		peakWeights,
		catalogueYears: normalizeYears(row[2], rowLabel),
		genres: normalizeGenres(row[3], rowLabel),
		books: books.map(([bookUlid, title]) => ({ bookUlid, title })),
		recognition: recognition.flatMap(([tier, receipts]) =>
			receipts.map(([workTitle, awardName, year, status]) => ({
				workTitle,
				awardName,
				year,
				status,
				tier
			}))
		)
	};
}

/** Calculate a detail shard from the population index, never from an author name. */
export function detailShardForAuthor(
	authorIndex: number,
	details: ProminenceDetailManifest
): number {
	validateDetailManifest(details);
	if (
		!Number.isInteger(authorIndex) ||
		authorIndex < details.index_base ||
		authorIndex >= details.author_count
	)
		fail(`Author population index ${authorIndex} is outside the detail population.`);
	return Math.floor((authorIndex - details.index_base) / details.shard_size);
}

export function detailShardPath(details: ProminenceDetailManifest, shardNumber: number): string {
	validateDetailManifest(details);
	if (!Number.isInteger(shardNumber) || shardNumber < 0 || shardNumber >= details.shard_count)
		fail(`Detail shard ${shardNumber} is outside the release.`);
	return details.path_pattern.replace('{shard}', String(shardNumber));
}

/** Validate every row in a complete shard and normalize its positional values. */
export function validateDetailShard(
	payload: unknown,
	manifest: ProminenceManifest,
	shardNumber: number
): NormalizedDetailShard {
	validateDetailManifest(manifest.details);
	const details = manifest.details;
	if (!Number.isInteger(shardNumber) || shardNumber < 0 || shardNumber >= details.shard_count)
		fail(`Detail shard ${shardNumber} is outside the release.`);
	if (!payload || typeof payload !== 'object') fail('Detail shard must be a JSON object.');
	const shard = payload as Partial<ProminenceDetailShard>;
	if (shard.schema_version !== details.schema_version)
		fail(`Detail shard schema_version must be ${details.schema_version}.`);
	const expectedStart = details.index_base + shardNumber * details.shard_size;
	if (shard.start !== expectedStart)
		fail(`Detail shard ${shardNumber} must start at population index ${expectedStart}.`);
	if (!exactColumns(shard.columns))
		fail(`Detail shard columns must be exactly ${DETAIL_COLUMNS.join(', ')}.`);
	if (!Array.isArray(shard.rows)) fail('Detail shard rows must be an array.');
	const expectedRows = Math.min(details.shard_size, details.author_count - expectedStart);
	if (shard.rows.length !== expectedRows)
		fail(
			`Detail shard ${shardNumber} contains ${shard.rows.length} rows; expected ${expectedRows}.`
		);
	const rows = shard.rows.map((row, rowIndex) =>
		normalizeRow(row, rowIndex, expectedStart, manifest)
	);
	return { schema_version: details.schema_version, start: expectedStart, rows };
}

export class AuthorDetailRepository {
	private readonly context: DetailRepositoryContext;
	private readonly cache = new Map<number, Promise<NormalizedDetailShard>>();

	constructor(context: DetailRepositoryContext) {
		validateDetailManifest(context.manifest.details, context.populationCount);
		this.context = context;
	}

	get cachedShardCount(): number {
		return this.cache.size;
	}

	clear(): void {
		this.cache.clear();
	}

	private fetchShard(shardNumber: number): Promise<NormalizedDetailShard> {
		const cached = this.cache.get(shardNumber);
		if (cached) return cached;
		const path = detailShardPath(this.context.manifest.details, shardNumber);
		const url = joinUrl(this.context.base, this.context.webRoot, path);
		const request = fetchJson<unknown>(url)
			.then((payload) => validateDetailShard(payload, this.context.manifest, shardNumber))
			.catch((error) => {
				if (this.cache.get(shardNumber) === request) this.cache.delete(shardNumber);
				throw error;
			});
		this.cache.set(shardNumber, request);
		return request;
	}

	getShard(shardNumber: number): Promise<NormalizedDetailShard> {
		return this.fetchShard(shardNumber);
	}

	getAuthorDetail(authorIndex: number): Promise<NormalizedAuthorDetail> {
		const shardNumber = detailShardForAuthor(authorIndex, this.context.manifest.details);
		return this.fetchShard(shardNumber).then((shard) => {
			const detail = shard.rows.find((row) => row.populationIndex === authorIndex);
			if (!detail) {
				this.cache.delete(shardNumber);
				fail(`Detail shard ${shardNumber} did not contain population index ${authorIndex}.`);
			}
			return detail;
		});
	}

	retryAuthor(authorIndex: number): Promise<NormalizedAuthorDetail> {
		const shardNumber = detailShardForAuthor(authorIndex, this.context.manifest.details);
		this.cache.delete(shardNumber);
		return this.getAuthorDetail(authorIndex);
	}
}

import type { ConnectionRecord, DirectionalityStatus } from './types';

/**
 * Binary decoder for the ACPI1 connection format.
 *
 * A bucket file is a plain concatenation of self-contained per-author blocks. Each block
 * is its own little ACPI1 unit:
 *
 *   0   5 bytes    magic "ACPI1", null-padded to 8
 *   8   uint32 LE  record count
 *   12  N × 96     records
 *
 * An author's `connection_offset` and `connection_bytes` locate its block inside the
 * bucket, so one ordinary static file serves ~35 authors and HTTP Range is never needed.
 * Blocks are decoded **in place** at a nonzero byte offset rather than copied out — the
 * offset arithmetic is the thing most likely to break, so every bound is checked.
 *
 * Record layout (offsets relative to the record start), per `manifest.connections`:
 *
 *   0   uint32 LE  other author id        48  float32 LE  reverse rate difference
 *   4   uint32 LE  pair id                52  float32 LE  reverse CI lower
 *   8   uint8      directionality status  56  float32 LE  reverse CI upper
 *   9   uint8      self selected          60  float32 LE  reverse log odds ratio
 *   10  uint8      reverse selected       64  float32 LE  reverse evidence score
 *   11  int8       self sign              68  float32 LE  reverse −log10 q
 *   12  uint8      selection fold count   72  float32 LE  reverse like rate
 *   13  3 bytes    reserved               76  float32 LE  reverse baseline rate
 *   16  float32 LE self rate difference   80  float32 LE  asymmetry difference
 *   20  float32 LE self CI lower          84  float32 LE  asymmetry CI lower
 *   24  float32 LE self CI upper          88  float32 LE  asymmetry CI upper
 *   28  float32 LE self log odds ratio    92  float32 LE  asymmetry −log10 q
 *   32  float32 LE self evidence score
 *   36  float32 LE self −log10 q
 *   40  float32 LE self like rate
 *   44  float32 LE self baseline rate
 */

export const CONNECTION_MAGIC = 'ACPI1';

const HEADER_BYTES = 12;
/** "ACPI1" is 5 characters null-padded into an 8-byte field. */
const MAGIC_BYTES = 5;
const COUNT_OFFSET = 8;
const RECORD_BYTES = 96;

export class ConnectionFormatError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ConnectionFormatError';
	}
}

function readMagic(view: DataView): string {
	let magic = '';
	for (let i = 0; i < MAGIC_BYTES; i++) {
		const byte = view.getUint8(i);
		if (byte === 0) break;
		magic += String.fromCharCode(byte);
	}
	return magic;
}

/**
 * Decode one author's block out of a cached bucket.
 *
 * A malformed block is an application error, not an empty result — callers must not fall
 * back to "no connections" when this throws. An author with no connections at all has a
 * null `connection_bucket` and never reaches this function.
 */
export function decodeConnectionBlock(
	bucket: ArrayBuffer,
	offset: number,
	bytes: number
): ConnectionRecord[] {
	if (!Number.isInteger(offset) || offset < 0) {
		throw new ConnectionFormatError(`Block offset ${offset} is not a non-negative integer.`);
	}
	if (!Number.isInteger(bytes) || bytes < HEADER_BYTES) {
		throw new ConnectionFormatError(
			`Block length ${bytes} is shorter than the ${HEADER_BYTES}-byte header.`
		);
	}
	if (offset + bytes > bucket.byteLength) {
		throw new ConnectionFormatError(
			`Block [${offset}, ${offset + bytes}) runs past the ${bucket.byteLength}-byte bucket.`
		);
	}

	const view = new DataView(bucket, offset, bytes);
	const magic = readMagic(view);
	if (magic !== CONNECTION_MAGIC) {
		throw new ConnectionFormatError(
			`Unexpected magic "${magic}" at offset ${offset} (expected "${CONNECTION_MAGIC}").`
		);
	}

	const count = view.getUint32(COUNT_OFFSET, true);
	const expectedBytes = HEADER_BYTES + count * RECORD_BYTES;
	if (bytes !== expectedBytes) {
		throw new ConnectionFormatError(
			`Block declares ${count} records (${expectedBytes} bytes) but the index says ${bytes}.`
		);
	}

	const records: ConnectionRecord[] = new Array(count);
	for (let i = 0; i < count; i++) {
		const at = HEADER_BYTES + i * RECORD_BYTES;
		const f = (delta: number) => view.getFloat32(at + delta, true);

		/*
		 * The asymmetry gap is absent for about 7% of records, and the artifact says so with
		 * `NaN` — "the fields are NaN only when neither orientation has an estimate". Passing
		 * that through would render "NaN% (95% interval NaN to NaN%)", and any comparison
		 * against it silently reads false.
		 *
		 * The all-zero check is a belt-and-braces holdover: an earlier build of this release
		 * signalled the same absence with [0, 0, 0], and a real estimate never lands exactly
		 * there. Either sentinel means the same thing — nothing was tested in this orientation,
		 * which is not the same as testing it and finding no gap.
		 */
		const difference = f(80);
		const ciLower = f(84);
		const ciUpper = f(88);
		const hasAsymmetry =
			Number.isFinite(difference) &&
			Number.isFinite(ciLower) &&
			Number.isFinite(ciUpper) &&
			(difference !== 0 || ciLower !== 0 || ciUpper !== 0);

		records[i] = {
			otherId: view.getUint32(at, true),
			pairId: view.getUint32(at + 4, true),
			status: view.getUint8(at + 8) as DirectionalityStatus,
			selfSign: view.getInt8(at + 11),
			self: {
				selected: view.getUint8(at + 9) !== 0,
				// The stored fold count belongs to this record's self → other direction only.
				selectionFoldCount: view.getUint8(at + 12),
				rateDifference: f(16),
				ciLower: f(20),
				ciUpper: f(24),
				logOddsRatio: f(28),
				evidenceScore: f(32),
				negLog10Q: f(36),
				likeRate: f(40),
				baselineRate: f(44)
			},
			reverse: {
				selected: view.getUint8(at + 10) !== 0,
				// Only the partner's copy records how the reverse direction fared across folds.
				selectionFoldCount: null,
				rateDifference: f(48),
				ciLower: f(52),
				ciUpper: f(56),
				logOddsRatio: f(60),
				evidenceScore: f(64),
				negLog10Q: f(68),
				likeRate: f(72),
				baselineRate: f(76)
			},
			asymmetry: hasAsymmetry ? { difference, ciLower, ciUpper, negLog10Q: f(92) } : null
		};
	}
	return records;
}

/**
 * Assert the manifest declares the geometry this decoder implements. Guards against a
 * future release changing the layout without changing the magic.
 */
export function assertConnectionGeometry(
	magic: string,
	headerBytes: number,
	recordSizeBytes: number
): void {
	if (magic !== CONNECTION_MAGIC) {
		throw new ConnectionFormatError(
			`Manifest declares connection magic "${magic}", expected "${CONNECTION_MAGIC}".`
		);
	}
	if (headerBytes !== HEADER_BYTES) {
		throw new ConnectionFormatError(
			`Manifest declares a ${headerBytes}-byte block header, expected ${HEADER_BYTES}.`
		);
	}
	if (recordSizeBytes !== RECORD_BYTES) {
		throw new ConnectionFormatError(
			`Manifest declares ${recordSizeBytes}-byte records, expected ${RECORD_BYTES}.`
		);
	}
}

/**
 * Flip a record to the other endpoint's point of view.
 *
 * The web buckets store each pair once per endpoint, so this is only needed when the
 * author we want has no block of its own but its partner does. Self and reverse swap, the
 * asymmetry difference negates, and the two one-sided status codes exchange places.
 */
export function reorientRecord(record: ConnectionRecord, selfId: number): ConnectionRecord {
	const status: DirectionalityStatus =
		record.status === 2 ? 3 : record.status === 3 ? 2 : record.status;
	return {
		otherId: selfId,
		pairId: record.pairId,
		status,
		selfSign: Math.sign(record.reverse.rateDifference),
		// Swapping the two estimates carries each one's fold count with it, which is exactly
		// right: the known count belongs to the direction it was measured on, not to an end.
		self: record.reverse,
		reverse: record.self,
		// Negating flips the interval end-for-end, so the lower bound stays the lower bound.
		// An absent gap stays absent — flipping cannot conjure one.
		asymmetry: record.asymmetry
			? {
					difference: -record.asymmetry.difference,
					ciLower: -record.asymmetry.ciUpper,
					ciUpper: -record.asymmetry.ciLower,
					negLog10Q: record.asymmetry.negLog10Q
				}
			: null
	};
}

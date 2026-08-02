import { describe, expect, it } from 'vitest';
import {
	assertConnectionGeometry,
	ConnectionFormatError,
	decodeConnectionBlock,
	reorientRecord
} from './decode';

const HEADER_BYTES = 12;
const RECORD_BYTES = 96;

interface RecordFixture {
	otherId: number;
	pairId: number;
	status: number;
	selfSelected: boolean;
	reverseSelected: boolean;
	selfSign: number;
	folds: number;
	/** 14 float32s: 8 self, ... actually 8 self + 8 reverse + 4 asymmetry = 20. */
	floats: number[];
}

/** 20 float32 fields: 8 self, 8 reverse, 4 asymmetry. */
function floatsFor(seed: number): number[] {
	return Array.from({ length: 20 }, (_, i) => Number(((seed + i) / 8).toFixed(4)));
}

/** Build one ACPI1 block exactly as the artifact writes it. */
function buildBlock(records: RecordFixture[], magic = 'ACPI1'): Uint8Array {
	const bytes = new Uint8Array(HEADER_BYTES + records.length * RECORD_BYTES);
	const view = new DataView(bytes.buffer);
	for (let i = 0; i < magic.length; i++) bytes[i] = magic.charCodeAt(i);
	view.setUint32(8, records.length, true);

	records.forEach((record, index) => {
		const at = HEADER_BYTES + index * RECORD_BYTES;
		view.setUint32(at, record.otherId, true);
		view.setUint32(at + 4, record.pairId, true);
		view.setUint8(at + 8, record.status);
		view.setUint8(at + 9, record.selfSelected ? 1 : 0);
		view.setUint8(at + 10, record.reverseSelected ? 1 : 0);
		view.setInt8(at + 11, record.selfSign);
		view.setUint8(at + 12, record.folds);
		record.floats.forEach((value, f) => view.setFloat32(at + 16 + f * 4, value, true));
	});

	return bytes;
}

/** Concatenate blocks into a bucket, returning each block's offset and length. */
function buildBucket(blocks: Uint8Array[]): {
	bucket: ArrayBuffer;
	slices: { offset: number; bytes: number }[];
} {
	const total = blocks.reduce((sum, block) => sum + block.byteLength, 0);
	const bucket = new Uint8Array(total);
	const slices: { offset: number; bytes: number }[] = [];
	let offset = 0;
	for (const block of blocks) {
		bucket.set(block, offset);
		slices.push({ offset, bytes: block.byteLength });
		offset += block.byteLength;
	}
	return { bucket: bucket.buffer, slices };
}

function fixture(overrides: Partial<RecordFixture> = {}): RecordFixture {
	return {
		otherId: 7,
		pairId: 99,
		status: 1,
		selfSelected: true,
		reverseSelected: true,
		selfSign: 1,
		folds: 5,
		floats: floatsFor(1),
		...overrides
	};
}

describe('decodeConnectionBlock', () => {
	it('decodes every field of a single record at offset zero', () => {
		const { bucket, slices } = buildBucket([buildBlock([fixture()])]);
		const [record] = decodeConnectionBlock(bucket, slices[0].offset, slices[0].bytes);

		expect(record.otherId).toBe(7);
		expect(record.pairId).toBe(99);
		expect(record.status).toBe(1);
		expect(record.selfSign).toBe(1);
		// The stored fold count is oriented: it describes self → other and nothing else.
		expect(record.self.selectionFoldCount).toBe(5);
		expect(record.reverse.selectionFoldCount).toBeNull();
		expect(record.self.selected).toBe(true);
		expect(record.reverse.selected).toBe(true);

		// Self takes floats 0-7, reverse 8-15, asymmetry 16-19, in declared order.
		const floats = floatsFor(1);
		expect(record.self.rateDifference).toBeCloseTo(floats[0], 5);
		expect(record.self.ciLower).toBeCloseTo(floats[1], 5);
		expect(record.self.ciUpper).toBeCloseTo(floats[2], 5);
		expect(record.self.logOddsRatio).toBeCloseTo(floats[3], 5);
		expect(record.self.evidenceScore).toBeCloseTo(floats[4], 5);
		expect(record.self.negLog10Q).toBeCloseTo(floats[5], 5);
		expect(record.self.likeRate).toBeCloseTo(floats[6], 5);
		expect(record.self.baselineRate).toBeCloseTo(floats[7], 5);
		expect(record.reverse.rateDifference).toBeCloseTo(floats[8], 5);
		expect(record.reverse.baselineRate).toBeCloseTo(floats[15], 5);
		expect(record.asymmetry).not.toBeNull();
		expect(record.asymmetry!.difference).toBeCloseTo(floats[16], 5);
		expect(record.asymmetry!.ciLower).toBeCloseTo(floats[17], 5);
		expect(record.asymmetry!.ciUpper).toBeCloseTo(floats[18], 5);
		expect(record.asymmetry!.negLog10Q).toBeCloseTo(floats[19], 5);
	});

	/*
	 * The offset arithmetic is the failure mode this format introduces: every author after the
	 * first in a bucket is read at a nonzero byte offset, and a decoder that ignores it happily
	 * returns the first author's relationships for everyone.
	 */
	it('decodes a block at a nonzero offset without bleeding into its neighbours', () => {
		const first = buildBlock([fixture({ otherId: 1, floats: floatsFor(10) })]);
		const second = buildBlock([
			fixture({ otherId: 2, pairId: 22, status: 2, floats: floatsFor(20) }),
			fixture({ otherId: 3, pairId: 33, status: 3, floats: floatsFor(30) })
		]);
		const third = buildBlock([fixture({ otherId: 4, floats: floatsFor(40) })]);
		const { bucket, slices } = buildBucket([first, second, third]);

		expect(slices[1].offset).toBeGreaterThan(0);

		const records = decodeConnectionBlock(bucket, slices[1].offset, slices[1].bytes);
		expect(records).toHaveLength(2);
		expect(records.map((r) => r.otherId)).toEqual([2, 3]);
		expect(records.map((r) => r.pairId)).toEqual([22, 33]);
		expect(records.map((r) => r.status)).toEqual([2, 3]);
		expect(records[0].self.rateDifference).toBeCloseTo(floatsFor(20)[0], 5);

		// The last block still decodes, which only holds if the view is bounded correctly.
		const last = decodeConnectionBlock(bucket, slices[2].offset, slices[2].bytes);
		expect(last[0].otherId).toBe(4);
	});

	it('decodes an empty block as no relationships', () => {
		const { bucket, slices } = buildBucket([buildBlock([])]);
		expect(decodeConnectionBlock(bucket, slices[0].offset, slices[0].bytes)).toEqual([]);
	});

	it('rejects a block whose magic is wrong', () => {
		const { bucket, slices } = buildBucket([buildBlock([fixture()], 'ACPB2')]);
		expect(() => decodeConnectionBlock(bucket, slices[0].offset, slices[0].bytes)).toThrow(
			ConnectionFormatError
		);
	});

	it('rejects a declared length that disagrees with the record count', () => {
		const { bucket, slices } = buildBucket([buildBlock([fixture(), fixture()])]);
		expect(() =>
			decodeConnectionBlock(bucket, slices[0].offset, slices[0].bytes - RECORD_BYTES)
		).toThrow(ConnectionFormatError);
	});

	it('rejects a block that runs past the end of the bucket', () => {
		const { bucket, slices } = buildBucket([buildBlock([fixture()])]);
		expect(() => decodeConnectionBlock(bucket, slices[0].offset, slices[0].bytes + 96)).toThrow(
			/past the/
		);
	});

	it('rejects a negative or fractional offset rather than coercing it', () => {
		const { bucket, slices } = buildBucket([buildBlock([fixture()])]);
		expect(() => decodeConnectionBlock(bucket, -1, slices[0].bytes)).toThrow(ConnectionFormatError);
		expect(() => decodeConnectionBlock(bucket, 1.5, slices[0].bytes)).toThrow(
			ConnectionFormatError
		);
	});

	it('rejects a length shorter than the header', () => {
		const { bucket } = buildBucket([buildBlock([fixture()])]);
		expect(() => decodeConnectionBlock(bucket, 0, 8)).toThrow(/header/);
	});

	/*
	 * The artifact stores the asymmetry per *oriented* claim, so the endpoint whose verdict
	 * runs other → self carries zeros and the real gap lives in the partner's copy. Measured
	 * against the release, status 3 is zeroed 100% of the time and status 2 never. Decoding
	 * those zeros as a measured value would report "we tested the gap and found nothing" for
	 * exactly the pairs whose gap is best established.
	 */
	it('decodes an all-zero asymmetry triple as absent, not as a measured zero', () => {
		const floats = floatsFor(1);
		floats[16] = 0; // difference
		floats[17] = 0; // ci lower
		floats[18] = 0; // ci upper
		const { bucket, slices } = buildBucket([buildBlock([fixture({ status: 3, floats })])]);
		const [record] = decodeConnectionBlock(bucket, slices[0].offset, slices[0].bytes);

		expect(record.asymmetry).toBeNull();
		// The two directions themselves are still fully populated.
		expect(record.self.rateDifference).toBeCloseTo(floats[0], 5);
		expect(record.reverse.rateDifference).toBeCloseTo(floats[8], 5);
	});

	/*
	 * The live signal for an absent gap. About 7% of records carry NaN — the release documents
	 * it as "neither orientation has an estimate". Passing it through renders "NaN% (95%
	 * interval NaN to NaN%)", and every comparison against it silently reads false.
	 */
	it('decodes a NaN asymmetry as absent', () => {
		const floats = floatsFor(1);
		floats[16] = Number.NaN;
		floats[17] = Number.NaN;
		floats[18] = Number.NaN;
		const { bucket, slices } = buildBucket([buildBlock([fixture({ status: 0, floats })])]);
		const [record] = decodeConnectionBlock(bucket, slices[0].offset, slices[0].bytes);

		expect(record.asymmetry).toBeNull();
		// The directions themselves are untouched.
		expect(record.self.rateDifference).toBeCloseTo(floats[0], 5);
	});

	it('treats a partly-NaN asymmetry as absent rather than half-reporting it', () => {
		const floats = floatsFor(1);
		floats[17] = Number.NaN;
		const { bucket, slices } = buildBucket([buildBlock([fixture({ floats })])]);
		const [record] = decodeConnectionBlock(bucket, slices[0].offset, slices[0].bytes);
		expect(record.asymmetry).toBeNull();
	});

	it('keeps an asymmetry whose point estimate is zero but whose interval is not', () => {
		const floats = floatsFor(1);
		floats[16] = 0;
		floats[17] = -0.04;
		floats[18] = 0.04;
		const { bucket, slices } = buildBucket([buildBlock([fixture({ floats })])]);
		const [record] = decodeConnectionBlock(bucket, slices[0].offset, slices[0].bytes);

		expect(record.asymmetry).not.toBeNull();
		expect(record.asymmetry?.difference).toBe(0);
		expect(record.asymmetry?.ciLower).toBeCloseTo(-0.04, 5);
	});
});

describe('assertConnectionGeometry', () => {
	it('accepts the geometry this decoder implements', () => {
		expect(() => assertConnectionGeometry('ACPI1', 12, 96)).not.toThrow();
	});

	it('rejects a changed record size behind an unchanged magic', () => {
		expect(() => assertConnectionGeometry('ACPI1', 12, 104)).toThrow(/96/);
	});

	it('rejects a changed header size', () => {
		expect(() => assertConnectionGeometry('ACPI1', 16, 96)).toThrow(/header/);
	});

	it('rejects the retired outbound magic', () => {
		expect(() => assertConnectionGeometry('ACPB2', 12, 96)).toThrow(/ACPI1/);
	});
});

describe('reorientRecord', () => {
	it('swaps the directions and negates the asymmetry interval', () => {
		const { bucket, slices } = buildBucket([
			buildBlock([fixture({ otherId: 7, status: 1, floats: floatsFor(3) })])
		]);
		const [original] = decodeConnectionBlock(bucket, slices[0].offset, slices[0].bytes);
		const flipped = reorientRecord(original, 42);

		expect(flipped.otherId).toBe(42);
		expect(flipped.pairId).toBe(original.pairId);
		expect(flipped.self).toEqual(original.reverse);
		expect(flipped.reverse).toEqual(original.self);
		expect(flipped.asymmetry?.difference).toBeCloseTo(-(original.asymmetry?.difference ?? 0), 5);
		// The interval flips end-for-end, so the lower bound stays the lower bound.
		expect(flipped.asymmetry?.ciLower).toBeCloseTo(-(original.asymmetry?.ciUpper ?? 0), 5);
		expect(flipped.asymmetry?.ciUpper).toBeCloseTo(-(original.asymmetry?.ciLower ?? 0), 5);
		expect(flipped.asymmetry!.ciLower).toBeLessThanOrEqual(flipped.asymmetry!.ciUpper);
	});

	it('carries the fold count with the direction it measured', () => {
		const { bucket, slices } = buildBucket([buildBlock([fixture({ folds: 4 })])]);
		const [original] = decodeConnectionBlock(bucket, slices[0].offset, slices[0].bytes);
		const flipped = reorientRecord(original, 42);

		expect(original.self.selectionFoldCount).toBe(4);
		expect(original.reverse.selectionFoldCount).toBeNull();
		// After flipping, 4 describes what is now the reverse direction.
		expect(flipped.self.selectionFoldCount).toBeNull();
		expect(flipped.reverse.selectionFoldCount).toBe(4);
	});

	it('leaves an absent asymmetry absent rather than inventing a zero', () => {
		const floats = floatsFor(1);
		floats[16] = floats[17] = floats[18] = 0;
		const { bucket, slices } = buildBucket([buildBlock([fixture({ status: 3, floats })])]);
		const [original] = decodeConnectionBlock(bucket, slices[0].offset, slices[0].bytes);

		const flipped = reorientRecord(original, 42);
		expect(original.asymmetry).toBeNull();
		expect(flipped.asymmetry).toBeNull();
		// The verdict still flips: from the partner's side this is self → other.
		expect(flipped.status).toBe(2);
	});

	/*
	 * The two one-sided codes are the only status values that carry an orientation, so they
	 * are the only ones that may change when the record is flipped. Getting this backwards
	 * would reverse the direction of the release's headline claim.
	 */
	it('exchanges the two one-sided verdicts and leaves the others alone', () => {
		const build = (status: number) => {
			const { bucket, slices } = buildBucket([buildBlock([fixture({ status })])]);
			return decodeConnectionBlock(bucket, slices[0].offset, slices[0].bytes)[0];
		};
		expect(reorientRecord(build(2), 1).status).toBe(3);
		expect(reorientRecord(build(3), 1).status).toBe(2);
		expect(reorientRecord(build(0), 1).status).toBe(0);
		expect(reorientRecord(build(1), 1).status).toBe(1);
		expect(reorientRecord(build(4), 1).status).toBe(4);
	});

	it('round-trips back to the original record', () => {
		const { bucket, slices } = buildBucket([
			buildBlock([fixture({ otherId: 7, status: 2, floats: floatsFor(5) })])
		]);
		const [original] = decodeConnectionBlock(bucket, slices[0].offset, slices[0].bytes);
		const round = reorientRecord(reorientRecord(original, 42), 7);

		expect(round.otherId).toBe(original.otherId);
		expect(round.status).toBe(original.status);
		expect(round.self).toEqual(original.self);
		expect(round.asymmetry?.difference).toBeCloseTo(original.asymmetry?.difference ?? 0, 5);
	});
});

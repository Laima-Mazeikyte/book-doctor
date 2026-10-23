import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { createLibrarySaveController, type LibraryChange } from './librarySaves';

const bookmark: LibraryChange = { kind: 'bookmark', bookId: 'uuid', bookUlid: 'ulid', value: true };
const rating: LibraryChange = { kind: 'rating', bookId: 'uuid', bookUlid: 'ulid', value: 4 };
const dismissal: LibraryChange = {
	kind: 'dismissal',
	bookId: 'uuid',
	bookUlid: 'ulid',
	value: true
};
function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}
const settle = async () => {
	for (let i = 0; i < 12; i++) await Promise.resolve();
};

describe('account-owned library saves', () => {
	let controllers: ReturnType<typeof createLibrarySaveController>[];
	let data: Map<string, string>;
	const storage = () => ({
		getItem: (key: string) => data.get(key) ?? null,
		setItem: (key: string, value: string) => {
			data.set(key, value);
		},
		removeItem: (key: string) => {
			data.delete(key);
		}
	});
	function create(account: string | null = 'A') {
		const c = createLibrarySaveController({ storage });
		controllers.push(c);
		c.activateOwner(account);
		return c;
	}
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(0);
		controllers = [];
		data = new Map();
	});
	afterEach(async () => {
		controllers.forEach((c) => c.destroy());
		await settle();
		vi.useRealTimers();
	});

	it('makes exactly the initial attempt and retries after 1, 2, and 5 seconds, then waits for Retry', async () => {
		const c = create();
		const times: number[] = [];
		let works = false;
		c.setWriter('bookmark', async () => {
			times.push(Date.now());
			if (!works) throw new Error('offline');
		});
		c.enqueue(bookmark);
		await settle();
		await vi.advanceTimersByTimeAsync(1000);
		await vi.advanceTimersByTimeAsync(2000);
		await vi.advanceTimersByTimeAsync(5000);
		expect(times).toEqual([0, 1000, 3000, 8000]);
		expect(get(c).failedCount).toBe(1);
		await expect(c.flush()).rejects.toThrow('could not be saved');
		c.setWriter('bookmark', async () => {
			times.push(Date.now());
		});
		await vi.advanceTimersByTimeAsync(60_000);
		expect(times).toHaveLength(4);
		works = true;
		await c.retryFailed();
		expect(times).toHaveLength(5);
		expect(get(c).queuedCount).toBe(0);
	});

	it.each([bookmark, rating, dismissal])(
		'retains a failed $kind across a reload without restarting its cycle',
		async (change) => {
			const first = create();
			first.setWriter(change.kind, async () => {
				throw new Error('offline');
			});
			first.enqueue(change);
			await vi.advanceTimersByTimeAsync(8000);
			expect(get(first).failedCount).toBe(1);
			first.destroy();
			const restored = create();
			const write = vi.fn();
			restored.setWriter(change.kind, write);
			await vi.advanceTimersByTimeAsync(60_000);
			expect(write).not.toHaveBeenCalled();
			expect(get(restored).changes[0]).toMatchObject({
				value: change.value,
				status: 'failed',
				attempts: 4
			});
			await restored.retryFailed();
			expect(write).toHaveBeenCalledOnce();
		}
	);

	it('waits for an active save and then the newer undo, without clearing it on the old acknowledgment', async () => {
		const c = create();
		const add = deferred();
		const remove = deferred();
		const write = vi.fn((change) => (change.value ? add.promise : remove.promise));
		c.setWriter('bookmark', write);
		c.enqueue(bookmark);
		await settle();
		c.enqueue({ ...bookmark, value: false });
		let finished = false;
		const flush = c.flush().then(() => {
			finished = true;
		});
		await settle();
		expect(finished).toBe(false);
		expect(write).toHaveBeenCalledOnce();
		add.resolve();
		await settle();
		expect(write).toHaveBeenCalledTimes(2);
		expect(get(c).changes[0].value).toBe(false);
		expect(finished).toBe(false);
		remove.resolve();
		await flush;
		expect(get(c).queuedCount).toBe(0);
	});

	it('coalesces clicks and serializes all three mutation kinds for the same book', async () => {
		const c = create();
		const first = deferred();
		const writes: string[] = [];
		c.setWriter('rating', async () => {
			writes.push('rating');
			await first.promise;
		});
		c.setWriter('bookmark', async () => {
			writes.push('bookmark');
		});
		c.setWriter('dismissal', async () => {
			writes.push('dismissal');
		});
		c.enqueue({ ...rating, value: 1 });
		c.enqueue(rating);
		c.enqueue(bookmark);
		c.enqueue(dismissal);
		await settle();
		expect(writes).toEqual(['rating']);
		expect(get(c).changes.find((c) => c.kind === 'rating')?.value).toBe(4);
		first.resolve();
		await c.flush();
		expect(writes).toEqual(['rating', 'bookmark', 'dismissal']);
	});

	it('does not replay one account into another, and resumes only the original account', async () => {
		const c = create();
		c.enqueue(bookmark);
		c.activateOwner(null);
		c.activateOwner('B');
		const other = vi.fn();
		c.setWriter('bookmark', other);
		await settle();
		expect(other).not.toHaveBeenCalled();
		expect(get(c).queuedCount).toBe(0);
		c.activateOwner('A');
		expect(get(c).queuedCount).toBe(1);
		const original = vi.fn();
		c.setWriter('bookmark', original);
		await c.flush();
		expect(original).toHaveBeenCalledOnce();
	});

	it('ignores an old in-flight completion after switching accounts', async () => {
		const c = create();
		const slow = deferred();
		c.setWriter('bookmark', () => slow.promise);
		c.enqueue(bookmark);
		await settle();
		c.activateOwner('B');
		c.enqueue({ ...bookmark, value: false });
		c.setWriter('bookmark', async () => {});
		await c.flush();
		slow.resolve();
		await settle();
		expect(get(c).ownerId).toBe('B');
		expect(get(c).queuedCount).toBe(0);
		expect(c.overlays('bookmark')[0].value).toBe(false);
	});

	it('binds only the guest draft explicitly claimed for a newly established anonymous session', async () => {
		const c = create(null);
		c.enqueue(bookmark);
		const draft = c.getOwner();
		c.claimGuest('anonymous-user', draft);
		c.activateOwner('anonymous-user');
		expect(get(c).changes[0].ownerId).toBe('anonymous-user');
		c.activateOwner('anonymous-user');
		expect(get(c).queuedCount).toBe(1);
		c.activateOwner('existing-user');
		expect(get(c).queuedCount).toBe(0);
		c.claimGuest('existing-user', draft);
		expect(get(c).queuedCount).toBe(0);
	});

	it('preserves acknowledgments against reads started before the mutation, but accepts newer reads', async () => {
		const c = create();
		const readRevision = c.getRevision();
		c.setWriter('bookmark', async () => {});
		c.enqueue(bookmark);
		await c.flush();
		expect(c.overlays('bookmark', readRevision)).toHaveLength(1);
		expect(c.overlays('bookmark', c.getRevision())).toHaveLength(0);
	});

	it('reports permission failures immediately without wasting retries', async () => {
		const c = create();
		const write = vi.fn(async () => {
			throw { status: 403, message: 'Denied' };
		});
		c.setWriter('rating', write);
		c.enqueue(rating);
		await vi.advanceTimersByTimeAsync(60_000);
		expect(write).toHaveBeenCalledOnce();
		expect(get(c).changes[0]).toMatchObject({ status: 'failed', errorKind: 'rejected' });
	});

	it('times out hung requests and exhausts its bounded retry cycle', async () => {
		const c = create();
		const write = vi.fn(() => new Promise<void>(() => {}));
		c.setWriter('bookmark', write);
		c.enqueue(bookmark);
		await vi.advanceTimersByTimeAsync(68_000);
		expect(write).toHaveBeenCalledTimes(4);
		expect(get(c).failedCount).toBe(1);
	});

	it('continues saving in memory when storage access throws', async () => {
		const c = createLibrarySaveController({
			storage: () => {
				throw new Error('Storage denied');
			}
		});
		controllers.push(c);
		c.activateOwner('A');
		c.setWriter('bookmark', async () => {});
		c.enqueue(bookmark);
		await c.flush();
		expect(get(c).queuedCount).toBe(0);
	});

	it('does not assign legacy ownership-free ratings to the restored account', async () => {
		data.set(
			'book-doctor:ratings-pending:v2',
			JSON.stringify([{ type: 'set', bookId: 'uuid', bookUlid: 'ulid', value: 5 }])
		);
		const c = create();
		const write = vi.fn();
		c.setWriter('rating', write);
		await settle();
		expect(write).not.toHaveBeenCalled();
		expect(data.has('book-doctor:ratings-pending:v2')).toBe(true);
	});

	it('resumes an unfinished retry cycle after reload using only the remaining attempts', async () => {
		const first = create();
		first.setWriter('bookmark', async () => {
			throw new Error('offline');
		});
		first.enqueue(bookmark);
		await vi.advanceTimersByTimeAsync(1000);
		expect(get(first).changes[0].attempts).toBe(2);
		first.destroy();
		const restored = create();
		const write = vi.fn(async () => {
			throw new Error('offline');
		});
		restored.setWriter('bookmark', write);
		await vi.advanceTimersByTimeAsync(1999);
		expect(write).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(5001);
		expect(write).toHaveBeenCalledTimes(2);
		expect(get(restored).changes[0]).toMatchObject({ status: 'failed', attempts: 4 });
	});

	it('keeps a guest draft in memory across account switches when storage is unavailable', () => {
		const c = createLibrarySaveController({ storage: () => null });
		controllers.push(c);
		c.activateOwner(null);
		const draft = c.getOwner();
		c.enqueue(bookmark);
		c.activateOwner('existing-account');
		expect(get(c).queuedCount).toBe(0);
		c.activateOwner(null);
		expect(c.getOwner()).toBe(draft);
		expect(get(c).queuedCount).toBe(1);
	});

	it('ignores malformed entries and discards broken display metadata without losing valid intent', async () => {
		data.set(
			'book-doctor:library-pending:v1:A',
			JSON.stringify([
				{
					...bookmark,
					ownerId: 'B',
					revision: 1,
					attempts: 0,
					status: 'pending',
					nextAttemptAt: 0
				},
				{
					...bookmark,
					ownerId: 'A',
					revision: 2,
					attempts: 0,
					status: 'pending',
					nextAttemptAt: 0,
					book: { title: 3 }
				},
				null,
				{ kind: 'unknown' }
			])
		);
		const c = create();
		expect(get(c).queuedCount).toBe(1);
		expect(get(c).changes[0].book).toBeUndefined();
		const write = vi.fn();
		c.setWriter('bookmark', write);
		await c.flush();
		expect(write).toHaveBeenCalledOnce();
	});
});

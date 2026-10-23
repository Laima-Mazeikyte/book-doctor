import { writable } from 'svelte/store';

export const LIBRARY_COLLECTIONS = [
	'ratings',
	'bookmarks',
	'dismissals',
	'ratedDetails',
	'bookmarkDetails'
] as const;
export type LibraryCollection = (typeof LIBRARY_COLLECTIONS)[number];
export interface LibraryLoadState {
	status: 'idle' | 'loading' | 'retrying' | 'ready' | 'error';
	hasSnapshot: boolean;
	error: string | null;
}
export interface LibraryLoadSnapshot {
	userId: string | null;
	collections: Record<LibraryCollection, LibraryLoadState>;
}
type Reader = (signal: AbortSignal) => Promise<() => void>;
type Job = { read: Reader; generation: number; isCurrent: () => boolean };
const RETRY_DELAYS = [1000, 2000, 5000];

function emptyCollections(): LibraryLoadSnapshot['collections'] {
	return Object.fromEntries(
		LIBRARY_COLLECTIONS.map((kind) => [kind, { status: 'idle', hasSnapshot: false, error: null }])
	) as LibraryLoadSnapshot['collections'];
}

/** Each reader prepares a snapshot; only the current, successful attempt may commit it. */
export function createLibraryLoadController(timeoutMs = 15_000) {
	let userId: string | null = null;
	let collections = emptyCollections();
	const jobs = new Map<LibraryCollection, Job>();
	const running = new Map<
		LibraryCollection,
		{ controller: AbortController; promise: Promise<void> }
	>();
	const state = writable<LibraryLoadSnapshot>({ userId, collections });
	const publish = () => state.set({ userId, collections: { ...collections } });
	function update(kind: LibraryCollection, value: Partial<LibraryLoadState>) {
		collections[kind] = { ...collections[kind], ...value };
		publish();
	}
	function activate(account: string | null) {
		if (account === userId) return;
		for (const run of running.values()) run.controller.abort();
		running.clear();
		jobs.clear();
		userId = account;
		collections = emptyCollections();
		publish();
	}
	function load(kind: LibraryCollection, retry = false): Promise<void> {
		const active = running.get(kind);
		if (active) return active.promise;
		const job = jobs.get(kind);
		if (!job || !job.isCurrent()) return Promise.resolve();
		if (!retry && ['ready', 'error'].includes(collections[kind].status)) return Promise.resolve();
		const account = userId;
		const controller = new AbortController();
		const current = () =>
			!controller.signal.aborted && userId === account && jobs.get(kind) === job && job.isCurrent();
		const promise = (async () => {
			for (let attempt = 0; attempt <= RETRY_DELAYS.length && current(); attempt++) {
				update(kind, attempt === 0 ? { status: 'loading', error: null } : { status: 'retrying' });
				const request = new AbortController();
				const abort = () => request.abort();
				controller.signal.addEventListener('abort', abort, { once: true });
				let timer: ReturnType<typeof setTimeout> | undefined;
				let removeAbort: (() => void) | undefined;
				try {
					const commit = await Promise.race([
						job.read(request.signal),
						new Promise<never>((_, reject) => {
							const onAbort = () => reject(new Error('Library load cancelled.'));
							request.signal.addEventListener('abort', onAbort, { once: true });
							removeAbort = () => request.signal.removeEventListener('abort', onAbort);
							timer = setTimeout(() => request.abort(), timeoutMs);
						})
					]);
					if (!current()) return;
					commit();
					update(kind, { status: 'ready', hasSnapshot: true, error: null });
					return;
				} catch (reason) {
					if (!current()) return;
					const error = reason as { message?: string; status?: number } | null;
					const message = error?.message ?? 'Could not load your books.';
					const permanent =
						error?.status != null &&
						error.status >= 400 &&
						error.status < 500 &&
						![408, 429].includes(error.status);
					if (attempt === RETRY_DELAYS.length || permanent) {
						update(kind, { status: 'error', error: message });
						return;
					}
					update(kind, { status: 'retrying', error: message });
				} finally {
					clearTimeout(timer);
					removeAbort?.();
					controller.signal.removeEventListener('abort', abort);
				}
				await new Promise<void>((resolve) => {
					const finish = () => {
						clearTimeout(delay);
						controller.signal.removeEventListener('abort', finish);
						resolve();
					};
					const delay = setTimeout(finish, RETRY_DELAYS[attempt]);
					controller.signal.addEventListener('abort', finish, { once: true });
					if (controller.signal.aborted) finish();
				});
			}
		})();
		const run = { controller, promise };
		running.set(kind, run);
		void promise.finally(() => {
			if (running.get(kind) === run) running.delete(kind);
		});
		return promise;
	}
	return {
		subscribe: state.subscribe,
		activate,
		register(
			account: string,
			kind: LibraryCollection,
			read: Reader,
			generation: number,
			isCurrent: () => boolean
		) {
			activate(account);
			const previous = jobs.get(kind);
			if (previous?.generation === generation) {
				previous.read = read;
				previous.isCurrent = isCurrent;
				return;
			}
			running.get(kind)?.controller.abort();
			running.delete(kind);
			jobs.set(kind, { read, generation, isCurrent });
			update(kind, { status: 'idle', error: null });
		},
		load,
		retry(kinds: readonly LibraryCollection[]) {
			return Promise.all(kinds.map((kind) => load(kind, true))).then(() => undefined);
		},
		visit(kinds: readonly LibraryCollection[]) {
			return Promise.all(
				kinds.map((kind) => load(kind, collections[kind].status === 'error'))
			).then(() => undefined);
		},
		markSnapshot(account: string, kinds: readonly LibraryCollection[]) {
			activate(account);
			for (const kind of kinds) update(kind, { hasSnapshot: true, status: 'ready', error: null });
		},
		reset() {
			for (const run of running.values()) run.controller.abort();
			running.clear();
			jobs.clear();
			userId = null;
			collections = emptyCollections();
			publish();
		}
	};
}

export const libraryLoads = createLibraryLoadController();

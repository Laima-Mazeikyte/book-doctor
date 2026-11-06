import { afterEach, describe, expect, it, vi } from 'vitest';
import { RequestTimeoutError, wait, withTimeout } from './timeout';

afterEach(() => vi.useRealTimers());

describe('withTimeout', () => {
	it('returns data and clears timers/listeners on success', async () => {
		vi.useFakeTimers();
		const parent = new AbortController();
		const remove = vi.spyOn(parent.signal, 'removeEventListener');
		await expect(withTimeout(async () => 42, { signal: parent.signal })).resolves.toBe(42);
		expect(vi.getTimerCount()).toBe(0);
		expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
	});

	it('does not start an already cancelled operation', async () => {
		const parent = new AbortController();
		parent.abort();
		const operation = vi.fn();
		await expect(withTimeout(operation, { signal: parent.signal })).rejects.toMatchObject({
			name: 'AbortError'
		});
		expect(operation).not.toHaveBeenCalled();
	});

	it('settles and aborts non-cooperative work without aborting the parent', async () => {
		vi.useFakeTimers();
		const parent = new AbortController();
		let child: AbortSignal | undefined;
		const result = withTimeout(
			(signal) => {
				child = signal;
				return new Promise(() => {});
			},
			{ timeoutMs: 100, signal: parent.signal }
		);
		const assertion = expect(result).rejects.toBeInstanceOf(RequestTimeoutError);
		await vi.advanceTimersByTimeAsync(100);
		await assertion;
		expect(child?.aborted).toBe(true);
		expect(parent.signal.aborted).toBe(false);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('cancels promptly during work and observes late rejection', async () => {
		vi.useFakeTimers();
		const parent = new AbortController();
		let rejectLate!: (error: Error) => void;
		const result = withTimeout(
			() =>
				new Promise((_, reject) => {
					rejectLate = reject;
				}),
			{
				signal: parent.signal
			}
		);
		const assertion = expect(result).rejects.toMatchObject({ name: 'AbortError' });
		parent.abort();
		await assertion;
		rejectLate(new Error('late transport failure'));
		await Promise.resolve();
		expect(vi.getTimerCount()).toBe(0);
	});

	it('bounds response body consumption and all steps with one timer', async () => {
		vi.useFakeTimers();
		const result = withTimeout(
			async (signal) => {
				await wait(70, signal);
				return new Promise(() => {}); // Headers arrived; body never completes.
			},
			{ timeoutMs: 100 }
		);
		const assertion = expect(result).rejects.toBeInstanceOf(RequestTimeoutError);
		await vi.advanceTimersByTimeAsync(100);
		await assertion;
		expect(vi.getTimerCount()).toBe(0);
	});

	it('preserves operation errors and cleans up synchronous throws', async () => {
		vi.useFakeTimers();
		const error = new Error('domain error');
		await expect(
			withTimeout(() => {
				throw error;
			})
		).rejects.toBe(error);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('keeps concurrent deadlines independent and ignores late success', async () => {
		vi.useFakeTimers();
		let resolveLate!: (value: string) => void;
		const first = withTimeout(
			() =>
				new Promise<string>((resolve) => {
					resolveLate = resolve;
				}),
			{ timeoutMs: 50 }
		);
		const second = withTimeout(
			async (signal) => {
				await wait(80, signal);
				return 'second';
			},
			{ timeoutMs: 100 }
		);
		const failure = expect(first).rejects.toBeInstanceOf(RequestTimeoutError);
		await vi.advanceTimersByTimeAsync(50);
		await failure;
		resolveLate('late');
		await vi.advanceTimersByTimeAsync(30);
		await expect(second).resolves.toBe('second');
		expect(vi.getTimerCount()).toBe(0);
	});
});

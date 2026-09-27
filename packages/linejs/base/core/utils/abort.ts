/** Await work that has no native AbortSignal support without delaying the
 * caller's cancellation until that work settles. The underlying operation may
 * still finish, so callers must keep later side effects behind another check. */
export function abortable<T>(
	start: () => Promise<T>,
	signal?: AbortSignal,
): Promise<T> {
	if (!signal) return start();
	signal.throwIfAborted();
	return new Promise<T>((resolve, reject) => {
		let settled = false;
		const finish = (callback: () => void) => {
			if (settled) return;
			settled = true;
			signal.removeEventListener("abort", onAbort);
			callback();
		};
		const onAbort = () => finish(() => reject(signal.reason));
		signal.addEventListener("abort", onAbort, { once: true });
		try {
			start().then(
				(value) => finish(() => resolve(value)),
				(error) => finish(() => reject(error)),
			);
		} catch (error) {
			finish(() => reject(error));
		}
	});
}

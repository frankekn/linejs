export type Continuable = { continuationToken?: string; [k: string]: unknown };

/**
 * Reads the continuation token off a response without requiring the
 * response type to declare it. Mirrors the old `_response.continuationToken`
 * property read: absent or falsy tokens end the loop.
 */
function getContinuationToken(response: unknown): string | undefined {
	if (
		typeof response === "object" && response !== null &&
		"continuationToken" in response
	) {
		const token: unknown = response.continuationToken;
		return typeof token === "string" ? token : undefined;
	}
	return undefined;
}

export async function continueRequest<P extends Continuable, R extends object>(
	handler: (param: P) => Promise<R>,
	arg: P,
): Promise<R> {
	function objectSum<O>(base: O, add: O): O {
		for (const key in add) {
			if (Object.prototype.hasOwnProperty.call(add, key)) {
				const value = add[key];
				if (typeof value === "object") {
					if (!base[key]) {
						base[key] = value;
					} else if (Array.isArray(value)) {
						base[key] = [
							...value,
							...base[key] as unknown[],
						] as O[Extract<keyof O, string>];
					} else {
						base[key] = objectSum(base[key], value);
					}
				} else {
					base[key] = value;
				}
			}
		}
		return base;
	}
	let responseSum: R | undefined;
	let continuationToken: string | undefined;
	while (true) {
		arg.continuationToken = continuationToken;
		const _response = await handler(arg);
		if (!responseSum) {
			responseSum = _response;
		} else {
			objectSum(responseSum, _response);
		}
		continuationToken = getContinuationToken(_response);
		if (!continuationToken) {
			return responseSum as R;
		}
	}
}

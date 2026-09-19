import { assertEquals, assertStrictEquals } from "@std/assert";
import { AuthService } from "./mod.ts";

function makeStubClient(rotated: boolean) {
	const store = new Map<string, string>([
		["refreshToken", "rt-old"],
	]);
	return {
		store,
		client: {
			authToken: "authtoken",
			config: { timeout: 10_000 },
			emit() {},
			storage: {
				get(k: string) {
					return Promise.resolve(store.get(k) ?? null);
				},
				set(k: string, v: string) {
					store.set(k, v);
					return Promise.resolve();
				},
			},
			request: {
				request() {
					return Promise.resolve({
						accessToken: "at-new",
						tokenIssueTimeEpochSec: 1000,
						durationUntilRefreshInSec: 3600,
						...(rotated ? { refreshToken: "rt-new" } : {}),
					});
				},
			},
		},
	};
}

// RefreshAccessTokenResponse carries a `refreshToken` field because the
// server may rotate it. Dropping it meant the next refresh reused the stale
// token and failed.
Deno.test("tryRefreshToken persists a rotated refreshToken", async () => {
	const stub = makeStubClient(true);
	const auth = new AuthService(stub.client as never);

	await auth.tryRefreshToken();

	assertEquals(stub.store.get("refreshToken"), "rt-new");
	assertEquals(String(stub.store.get("expire")), "4600");
});

Deno.test("tryRefreshToken keeps the stored refreshToken when not rotated", async () => {
	const stub = makeStubClient(false);
	const auth = new AuthService(stub.client as never);

	await auth.tryRefreshToken();

	assertEquals(stub.store.get("refreshToken"), "rt-old");
});

Deno.test("tryRefreshToken aborts its refresh request before mutating credentials", async () => {
	const controller = new AbortController();
	const reason = new DOMException("caller stopped", "AbortError");
	let receivedSignal: AbortSignal | undefined;
	const writes: string[] = [];
	const client = {
		authToken: "at-old",
		config: { timeout: 10_000 },
		emit() {},
		storage: {
			get: () => Promise.resolve("rt-old"),
			set(key: string) {
				writes.push(key);
				return Promise.resolve();
			},
		},
		request: {
			request(
				_value: unknown,
				_method: string,
				_protocol: unknown,
				_parse: unknown,
				_path: unknown,
				_headers: unknown,
				_timeout: unknown,
				signal?: AbortSignal,
			) {
				receivedSignal = signal;
				return new Promise((_resolve, reject) => {
					signal?.addEventListener(
						"abort",
						() => reject(signal.reason),
						{ once: true },
					);
				});
			},
		},
	};
	const refresh = new AuthService(client as never).tryRefreshToken(
		controller.signal,
	);
	for (let i = 0; i < 10 && !receivedSignal; i++) await Promise.resolve();
	assertStrictEquals(receivedSignal, controller.signal);
	controller.abort(reason);
	try {
		await refresh;
		throw new Error("token refresh resolved after cancellation");
	} catch (error) {
		assertStrictEquals(error, reason);
	}
	assertEquals(client.authToken, "at-old");
	assertEquals(writes, []);
});

Deno.test("a completed refresh persists rotated credentials before cancellation is published", async () => {
	const controller = new AbortController();
	const reason = new DOMException("listener stopped", "AbortError");
	const store = new Map<string, string>([["refreshToken", "rt-old"]]);
	const client = {
		authToken: "at-old",
		config: { timeout: 10_000 },
		emit(event: string) {
			if (event === "update:authtoken") controller.abort(reason);
		},
		storage: {
			get: (key: string) => Promise.resolve(store.get(key) ?? null),
			set(key: string, value: string) {
				store.set(key, String(value));
				return Promise.resolve();
			},
		},
		request: {
			request: () =>
				Promise.resolve({
					accessToken: "at-new",
					refreshToken: "rt-new",
					tokenIssueTimeEpochSec: 1000,
					durationUntilRefreshInSec: 3600,
				}),
		},
	};
	try {
		await new AuthService(client as never).tryRefreshToken(controller.signal);
		throw new Error("refresh did not report listener cancellation");
	} catch (error) {
		assertStrictEquals(error, reason);
	}
	assertEquals(store.get("refreshToken"), "rt-new");
	assertEquals(store.get("expire"), "4600");
	assertEquals(client.authToken, "at-new");
});

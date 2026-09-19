import { assert, assertEquals, assertStrictEquals } from "@std/assert";
import { Buffer } from "node:buffer";
import { E2EE } from "./mod.ts";

/** The per-user E2EE public key cache was keyed only by `keyId`
 *  (`e2eePublicKeys:${keyId}`). LINE key ids are small per-account counters,
 *  so two contacts both having key id 1 collided: the second contact's lookup
 *  returned the first contact's cached public key without any RPC, producing
 *  a wrong ECDH shared secret. */
function makeE2EE() {
	const store = new Map<string, string>();
	const negotiatedFor: string[] = [];
	const fakeBase = {
		profile: { mid: "u-self" },
		storage: {
			get(k: string) {
				return Promise.resolve(store.get(k) ?? null);
			},
			set(k: string, v: string) {
				store.set(k, v);
				return Promise.resolve();
			},
		},
		talk: {
			negotiateE2EEPublicKey({ mid }: { mid: string }) {
				negotiatedFor.push(mid);
				// Every account's first registered key gets keyId 1, but each
				// account has distinct key material.
				return Promise.resolve({
					specVersion: 2,
					publicKey: {
						keyId: 1,
						keyData: Buffer.from(`pub-of-${mid}`),
					},
				});
			},
			getE2EEPublicKeys() {
				return Promise.resolve([]);
			},
		},
		getToType() {
			return 0;
		},
		log() {},
	};
	return { e2ee: new E2EE(fakeBase as never), store, negotiatedFor };
}

Deno.test("getE2EELocalPublicKey — same keyId on two contacts does not cross-contaminate", async () => {
	const { e2ee, negotiatedFor } = makeE2EE();

	const keyA = await e2ee.getE2EELocalPublicKey("u-a", 1);
	assertEquals(keyA.toString(), "pub-of-u-a");
	assert(negotiatedFor.includes("u-a"));

	// Contact B has the same keyId=1 — must NOT be served A's cached key.
	const keyB = await e2ee.getE2EELocalPublicKey("u-b", 1);
	assertEquals(keyB.toString(), "pub-of-u-b");
	assert(negotiatedFor.includes("u-b"));

	// And repeated lookups still hit the (per-mid) cache.
	const keyA2 = await e2ee.getE2EELocalPublicKey("u-a", 1);
	assertEquals(keyA2.toString(), "pub-of-u-a");
	assertEquals(negotiatedFor.filter((m) => m === "u-a").length, 1);
});

Deno.test("getE2EELocalPublicKey — omitted keyId accepts the negotiated key", async () => {
	const { e2ee } = makeE2EE();
	// Previously this threw `E2EE key id undefined not found` even though
	// negotiation succeeded.
	const key = await e2ee.getE2EELocalPublicKey("u-a");
	assertEquals(key.toString(), "pub-of-u-a");
});

Deno.test("getE2EELocalPublicKey — cancellation stops a pending key negotiation", async () => {
	const controller = new AbortController();
	const reason = new DOMException("caller stopped", "AbortError");
	let calls = 0;
	let receivedSignal: AbortSignal | undefined;
	const e2ee = new E2EE({
		profile: { mid: "u-self" },
		storage: {
			get: () => Promise.resolve(null),
			set: () => Promise.resolve(),
		},
		talk: {
			negotiateE2EEPublicKey(_param: unknown, signal?: AbortSignal) {
				calls++;
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
		getToType: () => 0,
		log() {},
	} as never);

	const pending = e2ee.getE2EELocalPublicKey(
		"u-peer",
		1,
		controller.signal,
	);
	for (let i = 0; i < 10 && !receivedSignal; i++) await Promise.resolve();
	assertStrictEquals(receivedSignal, controller.signal);
	controller.abort(reason);
	try {
		await pending;
		throw new Error("key negotiation resolved after cancellation");
	} catch (error) {
		assertStrictEquals(error, reason);
	}
	assertEquals(calls, 1);

	const alreadyAborted = new AbortController();
	alreadyAborted.abort(reason);
	try {
		await e2ee.getE2EELocalPublicKey("u-peer", 1, alreadyAborted.signal);
		throw new Error("an already-aborted lookup resolved");
	} catch (error) {
		assertStrictEquals(error, reason);
	}
	assertEquals(calls, 1, "an already-aborted lookup starts no key RPC");
});

Deno.test("getE2EELocalPublicKey — cancellation wins over a delayed cached key", async () => {
	const controller = new AbortController();
	const reason = new DOMException("caller stopped", "AbortError");
	let release: ((value: string) => void) | undefined;
	let negotiations = 0;
	const e2ee = new E2EE({
		profile: { mid: "u-self" },
		storage: {
			get: () => new Promise<string>((resolve) => release = resolve),
			set: () => Promise.resolve(),
		},
		talk: {
			negotiateE2EEPublicKey() {
				negotiations++;
				return Promise.reject(new Error("unexpected key RPC"));
			},
		},
		getToType: () => 0,
		log() {},
	} as never);

	const lookup = e2ee.getE2EELocalPublicKey(
		"u-peer",
		1,
		controller.signal,
	);
	await Promise.resolve();
	controller.abort(reason);
	release?.(Buffer.alloc(32, 7).toString("base64"));
	try {
		await lookup;
		throw new Error("cached key resolved after cancellation");
	} catch (error) {
		assertStrictEquals(error, reason);
	}
	assertEquals(negotiations, 0);
});

Deno.test("getE2EESelfKeyData — cancellation stops fallback key recovery", async () => {
	const controller = new AbortController();
	const reason = new DOMException("caller stopped", "AbortError");
	let receivedSignal: AbortSignal | undefined;
	const e2ee = new E2EE({
		profile: { mid: "u-self" },
		storage: { get: () => Promise.resolve(null) },
		talk: {
			getE2EEPublicKeys(signal?: AbortSignal) {
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
		log() {},
	} as never);

	const recovery = e2ee.getE2EESelfKeyData("u-self", controller.signal);
	for (let i = 0; i < 10 && !receivedSignal; i++) await Promise.resolve();
	assertStrictEquals(receivedSignal, controller.signal);
	controller.abort(reason);
	try {
		await recovery;
		throw new Error("self-key recovery resolved after cancellation");
	} catch (error) {
		assertStrictEquals(error, reason);
	}
});

Deno.test("getE2EESelfKeyData — an already-aborted call starts no storage read", async () => {
	const controller = new AbortController();
	const reason = new DOMException("caller stopped", "AbortError");
	controller.abort(reason);
	let reads = 0;
	const e2ee = new E2EE({
		storage: {
			get() {
				reads++;
				return Promise.resolve(null);
			},
		},
	} as never);
	try {
		await e2ee.getE2EESelfKeyData("u-self", controller.signal);
		throw new Error("already-aborted recovery resolved");
	} catch (error) {
		assertStrictEquals(error, reason);
	}
	assertEquals(reads, 0);
});

Deno.test("getE2EESelfKeyDataByKeyId — abort rejects a hung storage read", async () => {
	const controller = new AbortController();
	const reason = new DOMException("caller stopped", "AbortError");
	let started = false;
	const e2ee = new E2EE({
		storage: {
			get() {
				started = true;
				return new Promise<never>(() => {});
			},
		},
	} as never);
	const lookup = e2ee.getE2EESelfKeyDataByKeyId(1, controller.signal);
	await Promise.resolve();
	assertEquals(started, true);
	controller.abort(reason);
	try {
		await lookup;
		throw new Error("hung storage lookup resolved after cancellation");
	} catch (error) {
		assertStrictEquals(error, reason);
	}
});

for (const path of ["cached alias", "server recovery"] as const) {
	Deno.test(`getE2EESelfKeyData — ${path} forwards cancellation to its nested lookup`, async () => {
		const controller = new AbortController();
		const reason = new DOMException("caller stopped", "AbortError");
		let reads = 0;
		let nestedStarted = false;
		const e2ee = new E2EE({
			profile: { mid: "u-self" },
			storage: {
				get() {
					reads++;
					if (reads === 1) {
						return Promise.resolve(
							path === "cached alias"
								? JSON.stringify({
									privKey: "private",
									pubKey: "public",
									keyId: 1,
								})
								: null,
						);
					}
					nestedStarted = true;
					return new Promise<never>(() => {});
				},
			},
			talk: {
				getE2EEPublicKeys: () => Promise.resolve([{ keyId: 1 }]),
			},
			log() {},
		} as never);
		const lookup = e2ee.getE2EESelfKeyData("u-self", controller.signal);
		for (let i = 0; i < 10 && !nestedStarted; i++) await Promise.resolve();
		controller.abort(reason);
		try {
			await lookup;
			throw new Error("nested self-key lookup resolved after cancellation");
		} catch (error) {
			assertStrictEquals(error, reason);
		}
	});
}

Deno.test("getE2EELocalPublicKey — abort rejects a hung negotiated-key cache write", async () => {
	const controller = new AbortController();
	const reason = new DOMException("caller stopped", "AbortError");
	let writeStarted = false;
	const e2ee = new E2EE({
		profile: { mid: "u-self" },
		storage: {
			get: () => Promise.resolve(null),
			set() {
				writeStarted = true;
				return new Promise<never>(() => {});
			},
		},
		talk: {
			negotiateE2EEPublicKey: () =>
				Promise.resolve({
					specVersion: 2,
					publicKey: { keyId: 1, keyData: Buffer.alloc(32, 7) },
				}),
		},
		getToType: () => 0,
		log() {},
	} as never);
	const lookup = e2ee.getE2EELocalPublicKey(
		"u-peer",
		1,
		controller.signal,
	);
	for (let i = 0; i < 10 && !writeStarted; i++) await Promise.resolve();
	controller.abort(reason);
	try {
		await lookup;
		throw new Error("key cache write resolved after cancellation");
	} catch (error) {
		assertStrictEquals(error, reason);
	}
});

Deno.test("getE2EESelfKeyData — cancellation wins while saving a recovered key", async () => {
	const controller = new AbortController();
	const reason = new DOMException("caller stopped", "AbortError");
	let releaseSave: (() => void) | undefined;
	let reads = 0;
	const e2ee = new E2EE({
		profile: { mid: "u-self" },
		storage: {
			get() {
				reads++;
				return Promise.resolve(
					reads === 1
						? null
						: JSON.stringify({ privKey: "private", pubKey: "public" }),
				);
			},
			set() {
				return new Promise<void>((resolve) => releaseSave = resolve);
			},
		},
		talk: {
			getE2EEPublicKeys: () => Promise.resolve([{ keyId: 1 }]),
		},
		log() {},
	} as never);
	const recovery = e2ee.getE2EESelfKeyData("u-self", controller.signal);
	for (let i = 0; i < 10 && !releaseSave; i++) await Promise.resolve();
	controller.abort(reason);
	releaseSave?.();
	try {
		await recovery;
		throw new Error("saved recovery resolved after cancellation");
	} catch (error) {
		assertStrictEquals(error, reason);
	}
});

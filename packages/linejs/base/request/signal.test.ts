import { assertStrictEquals } from "@std/assert";
import { RequestClient } from "./mod.ts";

Deno.test("RequestClient combines caller cancellation with its timeout", async () => {
	let captured: Request | undefined;
	const client = {
		deviceDetails: {
			device: "TEST",
			appVersion: "1.0",
			systemName: "TEST",
			systemVersion: "1",
		},
		config: { timeout: 10_000 },
		legy: { encrypted: false, endpoint: "https://gf.line.naver.jp/enc" },
		thrift: {
			writeThrift: () => new Uint8Array([1]),
		},
		log() {},
		fetch(request: Request) {
			captured = request;
			return new Promise<Response>((_resolve, reject) => {
				request.signal.addEventListener(
					"abort",
					() => reject(request.signal.reason),
					{ once: true },
				);
			});
		},
	};
	const request = new RequestClient(client as never);
	const controller = new AbortController();
	const reason = new DOMException("caller stopped", "AbortError");
	const pending = request.request(
		[],
		"negotiateE2EEPublicKey",
		3,
		true,
		"/S3",
		{},
		10_000,
		controller.signal,
	);
	await Promise.resolve();
	controller.abort(reason);

	try {
		await pending;
		throw new Error("request resolved after cancellation");
	} catch (error) {
		assertStrictEquals(error, reason);
	}
	assertStrictEquals(captured?.signal.aborted, true);
	assertStrictEquals(captured?.signal.reason, reason);
});

Deno.test("RequestClient honors cancellation after refresh-token storage", async () => {
	const controller = new AbortController();
	const reason = new DOMException("caller stopped", "AbortError");
	let releaseStorage: ((value: null) => void) | undefined;
	const client = {
		deviceDetails: {
			device: "TEST",
			appVersion: "1.0",
			systemName: "TEST",
			systemVersion: "1",
		},
		config: { timeout: 10_000 },
		legy: { encrypted: false, endpoint: "https://gf.line.naver.jp/enc" },
		storage: {
			get: () => new Promise<null>((resolve) => releaseStorage = resolve),
		},
		thrift: {
			writeThrift: () => new Uint8Array([1]),
			rename_thrift: (_name: string, value: unknown) => value,
			readThrift: () => ({
				data: { 1: { code: "MUST_REFRESH_V3_TOKEN" } },
			}),
		},
		log() {},
		fetch: () => Promise.resolve(new Response(new Uint8Array([1]))),
	};
	const request = new RequestClient(client as never);
	const pending = request.request(
		[],
		"test",
		3,
		false,
		"/S3",
		{},
		10_000,
		controller.signal,
	);
	for (let i = 0; i < 10 && !releaseStorage; i++) await Promise.resolve();
	controller.abort(reason);
	try {
		await pending;
		throw new Error("request resolved after cancellation");
	} catch (error) {
		assertStrictEquals(error, reason);
	}
});

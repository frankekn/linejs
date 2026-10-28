import { assert, assertEquals, assertRejects } from "@std/assert";
import { BaseClient } from "../core/mod.ts";
import { QrPollingExpiredError } from "./mod.ts";

function failingPoll(error: Error) {
	let calls = 0;
	const client = new BaseClient({
		device: "ANDROIDSECONDARY",
		fetch: () => Promise.reject(new Error("unexpected network access")),
	});
	client.request.request = async () => {
		calls++;
		throw error;
	};
	return { login: client.loginProcess, calls: () => calls };
}

for (
	const method of ["checkQrCodeVerified", "checkPinCodeVerified"] as const
) {
	for (
		const failure of [
			new DOMException("Signal timed out", "TimeoutError"),
			new Error("Request internal failed: status=408"),
			new Error("Request internal failed: status=410"),
		]
	) {
		Deno.test(`${method} marks only exhausted polling as expired: ${failure.message}`, async () => {
			const poll = failingPoll(failure);
			const error = await assertRejects(
				() => poll.login[method]("synthetic-session", 2, 150),
				QrPollingExpiredError,
			);
			assertEquals(poll.calls(), 2);
			assertEquals(error.code, "QR_POLLING_EXPIRED");
			assert(error.cause === failure);
			assert(!error.message.includes("synthetic-session"));
		});
	}

	Deno.test(`${method} preserves transport failure without retrying`, async () => {
		const failure = new TypeError("fetch failed");
		const poll = failingPoll(failure);
		const error = await assertRejects(
			() => poll.login[method]("synthetic-session", 2, 150),
			TypeError,
		);
		assert(error === failure);
		assertEquals(poll.calls(), 1);
	});

	for (
		const code of [
			"ABUSE_BLOCK",
			"BANNED",
			"EXCESSIVE_ACCESS",
			"NOT_AUTHORIZED_DEVICE",
			"MUST_REFRESH_V3_TOKEN",
		]
	) {
		Deno.test(`${method} does not retry or relabel ${code}`, async () => {
			const failure = new Error("timed out status=410", {
				cause: { data: { code } },
			});
			const poll = failingPoll(failure);
			const error = await assertRejects(
				() => poll.login[method]("synthetic-session", 2, 150),
				Error,
			);
			assert(error === failure);
			assert(!(error instanceof QrPollingExpiredError));
			assertEquals(poll.calls(), 1);
		});
	}

	Deno.test(`${method} makes no request with an exhausted polling budget`, async () => {
		const poll = failingPoll(new Error("must not be requested"));
		await assertRejects(
			() => poll.login[method]("synthetic-session", 0, 150),
			QrPollingExpiredError,
		);
		assertEquals(poll.calls(), 0);
	});
}

import { assert, assertEquals, assertRejects } from "@std/assert";
import { Buffer } from "node:buffer";
import crypto from "node:crypto";
import { chunkDigests, E2EE, MEDIA_TAG_CHUNK } from "./mod.ts";
import { InternalError } from "../core/utils/error.ts";

// `encryptByKeyMaterial` appends an HMAC-SHA256 of the ciphertext, but
// `decryptByKeyMaterial` silently discarded those 32 bytes without ever
// comparing them — tampered/corrupted media decrypted to garbage without
// error.
function makeE2EE() {
	return new E2EE({
		profile: { mid: "u-self" },
		storage: {
			get() {
				return Promise.resolve(null);
			},
			set() {
				return Promise.resolve();
			},
		},
		getToType() {
			return 0;
		},
		log() {},
	} as never);
}

Deno.test("decryptByKeyMaterial round-trips and verifies the HMAC", async () => {
	const e2ee = makeE2EE();
	const raw = Buffer.from("secret media payload");

	const { keyMaterial, encryptedData } = await e2ee.encryptByKeyMaterial(raw);
	assertEquals(encryptedData.length, raw.length + 32);

	const decrypted = await e2ee.decryptByKeyMaterial(
		encryptedData,
		keyMaterial,
	);
	assertEquals(decrypted.toString(), "secret media payload");
});

Deno.test("decryptByKeyMaterial rejects a tampered ciphertext", async () => {
	const e2ee = makeE2EE();
	const { keyMaterial, encryptedData } = await e2ee.encryptByKeyMaterial(
		Buffer.from("secret media payload"),
	);

	const tampered = Buffer.from(encryptedData);
	tampered[0] ^= 0x01;
	await assertRejects(
		() => e2ee.decryptByKeyMaterial(tampered, keyMaterial),
		InternalError as never,
		"HMAC verification failed",
	);
});

Deno.test("decryptByKeyMaterial rejects a wrong keyMaterial", async () => {
	const e2ee = makeE2EE();
	const { encryptedData } = await e2ee.encryptByKeyMaterial(
		Buffer.from("secret media payload"),
	);

	await assertRejects(
		() => e2ee.decryptByKeyMaterial(encryptedData, Buffer.alloc(32, 7)),
		InternalError as never,
		"HMAC verification failed",
	);
});

Deno.test("decryptByKeyMaterial rejects truncated input", async () => {
	const e2ee = makeE2EE();
	await assertRejects(
		() => e2ee.decryptByKeyMaterial(Buffer.alloc(10), Buffer.alloc(32)),
		InternalError as never,
		"too short",
	);
	assert(true);
});

// The LINE app's video tag: HMAC over the concatenated SHA-256 of each
// 128 KiB ciphertext chunk. Re-tag a linejs ciphertext the way the app does.
async function appTagged(e2ee: E2EE, raw: Buffer) {
	const { keyMaterial, encryptedData } = await e2ee.encryptByKeyMaterial(raw);
	const enc = encryptedData.subarray(0, -32);
	const { macKey } = await e2ee.deriveKeyMaterial(
		Buffer.from(keyMaterial, "base64"),
	);
	const tag = crypto.createHmac("sha256", macKey).update(chunkDigests(enc))
		.digest();
	return { keyMaterial, data: Buffer.concat([enc, tag]) };
}

Deno.test("decryptByKeyMaterial accepts the app's chunk-digest video tag", async () => {
	const e2ee = makeE2EE();
	// Two full chunks and a partial third, so chunking actually matters.
	const raw = crypto.randomBytes(MEDIA_TAG_CHUNK * 2 + 4097);
	const { keyMaterial, data } = await appTagged(e2ee, raw);
	const decrypted = await e2ee.decryptByKeyMaterial(data, keyMaterial);
	assert(decrypted.equals(raw));
});

Deno.test("decryptByKeyMaterial still rejects a tampered chunk-digest video", async () => {
	const e2ee = makeE2EE();
	const { keyMaterial, data } = await appTagged(
		e2ee,
		crypto.randomBytes(MEDIA_TAG_CHUNK + 10),
	);
	const tampered = Buffer.from(data);
	tampered[MEDIA_TAG_CHUNK + 3] ^= 0x01; // inside the second chunk
	await assertRejects(
		() => e2ee.decryptByKeyMaterial(tampered, keyMaterial),
		InternalError as never,
		"HMAC verification failed",
	);
});

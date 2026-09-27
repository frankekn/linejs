/**
 * Golden wire fixtures for the linejs thrift + E2EE encode/decode paths.
 *
 * These snapshots were recorded against the pre-refactor implementation
 * and pin observable behavior: every write path is pinned byte-for-byte
 * (hex), every read/rename path via a deterministic JSON encoding
 * (Buffers → `bytes:<hex>`, bigints → `bigint:<dec>`).
 *
 * If a legitimate wire change is ever intended, regenerate these
 * constants deliberately — do not "fix" a failing fixture silently.
 */
import { writeStruct, writeThrift } from "./write.ts";
import { readThrift } from "./read.ts";
import { ThriftRenameParser } from "../rename/parser.ts";
import { Protocols } from "./declares.ts";
import { Thrift as ThriftDef } from "@frankekn/linejs-types/thrift";
import { RepairTriggerGroupMembersElement } from "./struct.ts";
import nacl from "tweetnacl";
import { E2EE } from "../../e2ee/mod.ts";
import type { BaseClient } from "../../core/mod.ts";
import { Buffer } from "node:buffer";
import crypto from "node:crypto";

const hex = (b: Uint8Array | Buffer) => Buffer.from(b).toString("hex");

/** Deterministic JSON encoding for wire values. */
function wireJson(value: unknown): string {
	return JSON.stringify(value, (_k, v) => {
		if (typeof v === "bigint") return `bigint:${v}`;
		if (v instanceof Uint8Array) {
			return `bytes:${Buffer.from(v).toString("hex")}`;
		}
		return v;
	});
}

const compact = Protocols[4];
const binary = Protocols[3];

// Fixed curve25519 keypair (privKey = 32 × 0x01, pubKey derived once).
const privKey = Buffer.alloc(32, 0x01);
const pubKey = Buffer.from(nacl.scalarMult.base(new Uint8Array(privKey)));
const e2ee = new E2EE({ log() {} } as unknown as BaseClient);

function loginZArgs(): NestedArrayLike {
	return [
		[
			12,
			2,
			[
				[8, 1, 1],
				[8, 2, 1],
				[11, 3, "keynm-fixture"],
				[11, 4, "rsa-encrypted-blob"],
				[2, 5, 0],
				[11, 6, ""],
				[11, 7, "ANDROID\t10.16.2\tlinejs\t11"],
				[11, 8, "cert-data-fixture"],
				[11, 9, "verifier-token-fixture"],
				[11, 10, Buffer.from("secret-bytes-fixture")],
				[8, 11, 1],
				[11, 12, "System Product Name"],
			],
		],
	];
}

// Narrow local alias so the fixture file does not depend on the type
// surface under refactoring; the values are what matter here.
type NestedArrayLike = unknown[];

Deno.test("F1: loginZ struct over compact protocol is byte-stable", () => {
	const out = writeThrift(loginZArgs() as never, "loginZ", compact);
	const golden =
		"822100066c6f67696e5a2c15021502180d6b65796e6d2d6669787475726518127273612d656e637279707465642d626c6f621218001819414e44524f49440931302e31362e32096c696e656a730931311811636572742d646174612d66697874757265181676657269666965722d746f6b656e2d6669787475726518147365637265742d62797465732d666978747572651502181353797374656d2050726f64756374204e616d65000000";
	if (hex(out) !== golden) throw new Error(hex(out));
});

Deno.test("F2: loginZ struct over binary protocol is byte-stable", () => {
	const out = writeThrift(loginZArgs() as never, "loginZ", binary);
	const golden =
		"80010001000000066c6f67696e5a000000000c000208000100000001080002000000010b00030000000d6b65796e6d2d666978747572650b0004000000127273612d656e637279707465642d626c6f62020005000b0006000000000b000700000019414e44524f49440931302e31362e32096c696e656a730931310b000800000011636572742d646174612d666978747572650b00090000001676657269666965722d746f6b656e2d666978747572650b000a000000147365637265742d62797465732d6669787475726508000b000000010b000c0000001353797374656d2050726f64756374204e616d65000000";
	if (hex(out) !== golden) throw new Error(hex(out));
});

Deno.test("F3: login QR v2 ForSecure struct is byte-stable", () => {
	const out = writeThrift(
		[[12, 1, [
			[11, 1, "auth-session-id-fixture"],
			[11, 2, "linejs-v2"],
			[11, 3, "evex-device"],
			[2, 4, true],
			[11, 5, "nonce-fixture-1234"],
		]]] as never,
		"qrCodeLoginV2ForSecure",
		compact,
	);
	const golden =
		"822100167172436f64654c6f67696e5632466f725365637572651c1817617574682d73657373696f6e2d69642d6669787475726518096c696e656a732d7632180b657665782d6465766963651118126e6f6e63652d666978747572652d31323334000000";
	if (hex(out) !== golden) throw new Error(hex(out));
});

Deno.test("F4: i64/i32/i16/byte fields are byte-stable", () => {
	const out = writeStruct(
		[
			[10, 1, 618946633287860670n],
			[10, 2, -618946633287860670n],
			[10, 3, 42n],
			[8, 4, 1234],
			[6, 5, 300],
			[3, 6, 200],
		] as never,
		compact,
	);
	const golden =
		"16fc86e0c0e0abf8961116fb86e0c0e0abf89611165415a41314d80413c800";
	if (hex(out) !== golden) throw new Error(hex(out));
});

Deno.test("F5: MAP with declared i32 keys coerces keys byte-stably", () => {
	const out = writeStruct(
		[[13, 1, [8, 11, { 1: "one", 2: "two", 30: "thirty" }]]] as never,
		compact,
	);
	const golden = "1b035802036f6e65040374776f3c0674686972747900";
	if (hex(out) !== golden) throw new Error(hex(out));
});

Deno.test("F6: LIST / SET / nested STRUCT are byte-stable", () => {
	const out = writeStruct(
		[
			[15, 1, [11, ["a", "b", "c"]]],
			[14, 2, [11, ["x", "y"]]],
			[12, 3, [[11, 1, "inner"], [8, 2, 7]]],
		] as never,
		compact,
	);
	const golden = "19380161016201631a28017801791c1805696e6e6572150e0000";
	if (hex(out) !== golden) throw new Error(hex(out));
});

Deno.test("F7: empty struct value drops the whole field (pinned quirk)", () => {
	const out = writeStruct(
		[[12, 1, []], [11, 2, "after"]] as never,
		compact,
	);
	const golden = "2805616674657200";
	if (hex(out) !== golden) throw new Error(hex(out));
});

Deno.test("F8: readThrift of a result-shaped message is snapshot-stable", () => {
	const wire = writeThrift(
		[[12, 1, [[11, 1, "success-str"], [8, 2, 3]]], [12, 2, [[8, 1, 5], [
			11,
			2,
			"err",
		]]]] as never,
		"getAuthRSAKey",
		compact,
	);
	const parsed = readThrift(wire, compact);
	const golden =
		'{"data":{"1":{"1":"success-str","2":3},"2":{"1":5,"2":"err"}},"_info":{"fname":"getAuthRSAKey","mtype":1,"rseqid":0}}';
	if (wireJson(parsed) !== golden) throw new Error(wireJson(parsed));
});

Deno.test("F9: i64 decoding (negative two's-complement, unsafe bigint, safe number)", () => {
	const wire = writeThrift(
		[[10, 1, -618946633287860670n], [10, 2, 2n ** 53n], [10, 3, -1n]] as never,
		"i64probe",
		compact,
	);
	const parsed = readThrift(wire, compact);
	const golden =
		'{"data":{"1":"bigint:-618946633287860670","2":"bigint:9007199254740992","3":-1},"_info":{"fname":"i64probe","mtype":1,"rseqid":0}}';
	if (wireJson(parsed) !== golden) throw new Error(wireJson(parsed));
});

Deno.test("F10: binary vs UTF-8 string fields on the read path", () => {
	const wire = writeThrift(
		[
			[11, 1, Buffer.from([0x00, 0xff, 0x81, 0x0d, 0xfe])],
			[11, 2, "utf8-text"],
		] as never,
		"binprobe",
		compact,
	);
	const parsed = readThrift(wire, compact);
	const golden =
		'{"data":{"1":{"type":"Buffer","data":[0,255,129,13,254]},"2":"utf8-text"},"_info":{"fname":"binprobe","mtype":1,"rseqid":0}}';
	if (wireJson(parsed) !== golden) throw new Error(wireJson(parsed));
});

Deno.test("F11: MAP / SET / DOUBLE / BOOL read path", () => {
	const wire = writeThrift(
		[
			[13, 1, [11, 11, { k: "v" }]],
			[14, 2, [8, [1, 2, 3]]],
			[4, 3, 3.25],
			[2, 4, 1],
		] as never,
		"mapsetdouble",
		compact,
	);
	const parsed = readThrift(wire, compact);
	const golden =
		'{"data":{"1":{"k":"v"},"2":[1,2,3],"3":3.25,"4":true},"_info":{"fname":"mapsetdouble","mtype":1,"rseqid":0}}';
	if (wireJson(parsed) !== golden) throw new Error(wireJson(parsed));
});

Deno.test("F12: rename_thrift over the real LINE def (struct + enum paths)", () => {
	const parser = new ThriftRenameParser();
	parser.def = ThriftDef as typeof parser.def;
	const renamed = parser.rename_thrift("getAuthRSAKey_result", {
		0: { 1: "keynm-value", 2: "n-value", 3: "e-value", 4: "session-key-value" },
		1: { 1: 5, 2: 10, 3: "MESSAGE_NOT_FOUND" },
	});
	const golden =
		'{"success":{"keynm":"keynm-value","nvalue":"n-value","evalue":"e-value","sessionKey":"session-key-value"},"e":{"code":"NOT_FOUND","reason":10,"parameterMap":"MESSAGE_NOT_FOUND"}}';
	if (wireJson(renamed) !== golden) throw new Error(wireJson(renamed));
});

Deno.test("F12b: enum table rename maps fid to name", () => {
	const enumParser = new ThriftRenameParser();
	enumParser.def = {
		AR0_g: ThriftDef.AR0_g,
		thing_result: [{ fid: 0, name: "provider", struct: "AR0_g" }],
	} as typeof enumParser.def;
	const renamed = enumParser.rename_thrift("thing_result", { 0: 16641 });
	const golden = '{"provider":"ILLEGAL_ARGUMENT"}';
	if (wireJson(renamed) !== golden) throw new Error(wireJson(renamed));
});

Deno.test("F12c: rename with unknown struct keeps fid keys", () => {
	const parser = new ThriftRenameParser();
	parser.def = ThriftDef as typeof parser.def;
	const renamed = parser.rename_thrift("NoSuchStruct_result", {
		3: "kept-as-is",
	});
	const golden = '{"3":"kept-as-is"}';
	if (wireJson(renamed) !== golden) throw new Error(wireJson(renamed));
});

Deno.test("F12d: rename_data renames in place under the message fname", () => {
	const parser = new ThriftRenameParser();
	parser.def = ThriftDef as typeof parser.def;
	const renamed = parser.rename_data({
		data: { 0: { 1: "k" }, 1: { 3: "INTERNAL_ERROR" } },
		_info: { fname: "getAuthRSAKey", mtype: 2, rseqid: 0 },
	} as never);
	const golden =
		'{"data":{"success":{"keynm":"k"},"e":{"parameterMap":"INTERNAL_ERROR"}},"_info":{"fname":"getAuthRSAKey","mtype":2,"rseqid":0}}';
	if (wireJson(renamed) !== golden) throw new Error(wireJson(renamed));
});

Deno.test("F13: struct.ts MAP-of-struct generator (map() helper) is byte-stable", () => {
	const out = writeStruct(
		RepairTriggerGroupMembersElement({
			matchedGroups: {
				"u0aaaa000000000000000000000000aaa": {
					numMembers: 3,
					invalidGroup: false,
				},
			},
			mismatchedGroups: {},
			nextCallIntervalMinutes: 5,
		}) as never,
		compact,
	);
	const golden =
		"1b018c21753061616161303030303030303030303030303030303030303030303030616161150622001b00150a00";
	if (hex(out) !== golden) throw new Error(hex(out));
});

Deno.test("F14: E2EE primitives (shared secret, AAD, int bytes, xor, sha256)", () => {
	const checks: Array<[string, string, string]> = [
		[
			"sharedSecret",
			hex(e2ee.generateSharedSecret(privKey, pubKey)),
			"f311d440a5f15fac9cbdc78fbb90b63a6c6880148e79159dd258f036bf2f792c",
		],
		[
			"aad",
			hex(
				e2ee.generateAAD(
					"u0aaaa000000000000000000000000aaa",
					"u0bbbb000000000000000000000000bbb",
					1,
					2,
					2,
					0,
				),
			),
			"75306161616130303030303030303030303030303030303030303030303061616175306262626230303030303030303030303030303030303030303030303062626200000001000000020000000200000000",
		],
		["intBytes", hex(e2ee.getIntBytes(777)), "00000309"],
		[
			"xor",
			hex(
				e2ee.xor(
					Buffer.concat([Buffer.alloc(16, 0x0f), Buffer.alloc(16, 0xf0)]),
				),
			),
			"ffffffffffffffffffffffffffffffff",
		],
		[
			"sha256Key",
			hex(e2ee.getSHA256Sum(Buffer.from("fixture"), "Key")),
			"16ba39d142ec511a7e6f601bf3cfbacf96161da6e2a442f26381755e4488634a",
		],
	];
	for (const [name, actual, golden] of checks) {
		if (actual !== golden) throw new Error(`${name}: ${actual}`);
	}
});

Deno.test("F17: AES-ECB device-secret encryption is byte-stable", () => {
	const out = e2ee.encryptAESECB(
		e2ee.getSHA256Sum("114514"),
		Buffer.alloc(32, 0xab),
	);
	const golden =
		"fa244dbc5ad3883785cb19c7b760d72efa244dbc5ad3883785cb19c7b760d72e";
	if (hex(out) !== golden) throw new Error(hex(out));
});

Deno.test("F15: E2EE v2 payload structure (fixed salt/sign -> stable wire)", () => {
	const saltV2 = Buffer.alloc(16, 0x11);
	const signV2 = Buffer.alloc(12, 0x22);
	const aesKeyV2 = e2ee.generateSharedSecret(privKey, pubKey);
	const gcmKeyV2 = e2ee.getSHA256Sum(Buffer.from(aesKeyV2), saltV2, "Key");
	const aadV2 = e2ee.generateAAD(
		"u0bbbb000000000000000000000000bbb",
		"u0aaaa000000000000000000000000aaa",
		3,
		4,
		2,
		0,
	);
	const encV2 = e2ee.encryptE2EEMessageV2(
		Buffer.from(JSON.stringify({ text: "fixture-v2", meta: "m1" })),
		gcmKeyV2,
		signV2,
		aadV2,
	);
	const chunksV2 = [
		saltV2,
		encV2,
		signV2,
		e2ee.getIntBytes(3),
		e2ee.getIntBytes(4),
	];
	const golden =
		"11111111111111111111111111111111e3209f30dd55863c92d328bf2f663764ee3f3c69e1a0d93d8589d4c5dfee004c881ada4f2446df1026d4615ef0f484ebf52222222222222222222222220000000300000004";
	const actual = chunksV2.map((c) => Buffer.from(c).toString("hex")).join("");
	if (actual !== golden) throw new Error(actual);

	const decV2 = e2ee.decryptE2EEMessageV2(
		"u0bbbb000000000000000000000000bbb",
		"u0aaaa000000000000000000000000aaa",
		chunksV2.map((c) => Buffer.from(c)),
		privKey,
		pubKey,
		2,
		0,
	);
	const decGolden = '{"text":"fixture-v2","meta":"m1"}';
	if (wireJson(decV2) !== decGolden) throw new Error(wireJson(decV2));
});

Deno.test("F16: E2EE v1 (AES-256-CBC) decryption round trip", () => {
	const saltV1 = Buffer.alloc(16, 0x33);
	const aesKeyV1 = e2ee.generateSharedSecret(privKey, pubKey);
	const key1 = e2ee.getSHA256Sum(Buffer.from(aesKeyV1), saltV1, "Key");
	const iv1 = e2ee.xor(e2ee.getSHA256Sum(Buffer.from(aesKeyV1), saltV1, "IV"));
	const cipher1 = crypto.createCipheriv("aes-256-cbc", key1, iv1);
	const ctV1 = Buffer.concat([
		cipher1.update(
			Buffer.from(JSON.stringify({ keyId: 1, text: "fixture-v1" })),
		),
		cipher1.final(),
	]);
	const decV1 = e2ee.decryptE2EEMessageV1([saltV1, ctV1], privKey, pubKey);
	const golden = '{"keyId":1,"text":"fixture-v1"}';
	if (wireJson(decV1) !== golden) throw new Error(wireJson(decV1));
});

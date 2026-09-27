// @ts-types="thrift-types"
import * as thrift from "thrift";

import { Buffer } from "node:buffer";
import type { ParsedThrift } from "./declares.ts";

/**
 * A decoded thrift struct: field-id keyed, values as produced by
 * {@link readValue}.
 */
type ThriftStructData = Record<PropertyKey, unknown>;

/**
 * @returns {ThriftStructData}
 */
function readStruct(
	input: thrift.TCompactProtocol | thrift.TBinaryProtocol,
): ThriftStructData {
	const Thrift = thrift.Thrift;
	const returnData: ThriftStructData = {};
	input.readStructBegin();
	while (true) {
		const { ftype, fid } = input.readFieldBegin();
		if (ftype == Thrift.Type.STOP) {
			break;
		}
		returnData[fid] = readValue(input, ftype);
		input.readFieldEnd();
	}
	input.readStructEnd();
	return returnData;
}

function isBinary(bin: Buffer) {
	try {
		new TextDecoder("utf-8", { fatal: true }).decode(bin);
		return false;
	} catch {
		return true;
	}
}

function bigInt(bin: Buffer): number | bigint {
	let value = BigInt("0x" + bin.toString("hex"));
	// I64 is two's-complement; when the sign bit is set the raw hex
	// interpretation yields 2^64 + value, so subtract it to recover
	// the negative number the sender wrote.
	if (bin.length === 8 && bin[0] & 0x80) {
		value -= BigInt(1) << 64n;
	}
	if (
		value >= BigInt(Number.MIN_SAFE_INTEGER) &&
		value <= BigInt(Number.MAX_SAFE_INTEGER)
	) {
		return Number(value);
	}
	return value;
}

function readValue(
	input: thrift.TCompactProtocol | thrift.TBinaryProtocol,
	ftype: thrift.Thrift.Type,
): unknown {
	const Thrift = thrift.Thrift;
	if (ftype == Thrift.Type.STRUCT) {
		return readStruct(input);
	} else if (ftype == Thrift.Type.I32) {
		return input.readI32();
	} else if (ftype == Thrift.Type.I64) {
		return bigInt(input.readI64().buffer);
	} else if (ftype == Thrift.Type.STRING) {
		const bin = input.readBinary();
		if (isBinary(bin)) {
			return bin;
		} else {
			return bin.toString();
		}
	} else if (ftype == Thrift.Type.LIST) {
		const returnData: unknown[] = [];
		const { size, etype } = input.readListBegin();
		for (let _i = 0; _i < size; ++_i) {
			returnData.push(readValue(input, etype));
		}
		input.readListEnd();
		return returnData;
	} else if (ftype == Thrift.Type.MAP) {
		const returnData: Record<PropertyKey, unknown> = {};
		const { size, ktype, vtype } = input.readMapBegin();
		for (let _i = 0; _i < size; ++_i) {
			const key = readValue(input, ktype);
			const val = readValue(input, vtype);
			// ToPropertyKey(key) === String(key) for every value the thrift
			// reader can produce (string/number/bigint/bool/object), so this
			// is exactly the old `returnData[key] = val` coercion.
			returnData[String(key)] = val;
		}
		input.readMapEnd();
		return returnData;
	} else if (ftype == Thrift.Type.SET) {
		const returnData: unknown[] = [];
		const { size, etype } = input.readSetBegin();
		for (let _i = 0; _i < size; ++_i) {
			returnData.push(readValue(input, etype));
		}
		input.readSetEnd();
		return returnData;
	} else if (ftype == Thrift.Type.BOOL) {
		return input.readBool();
	} else if (ftype == Thrift.Type.BYTE) {
		return input.readByte();
	} else if (ftype == Thrift.Type.I16) {
		return input.readI16();
	} else if (ftype == Thrift.Type.DOUBLE) {
		return input.readDouble();
	} else if (ftype == 16) {
		// @ts-expect-error: TODO
		return input.readIString();
	} else if (ftype == 17) {
		// @ts-expect-error: TODO
		return input.readLineMid();
	} else {
		input.skip(ftype);
		return;
	}
}

function _readThrift(
	data: Uint8Array | Buffer,
	Protocol: typeof thrift.TCompactProtocol | typeof thrift.TBinaryProtocol =
		thrift.TCompactProtocol,
): ParsedThrift {
	const bufTrans = new thrift.TFramedTransport(
		data instanceof Buffer ? data : Buffer.from(data),
	);
	const proto = new Protocol(bufTrans);
	const msg_info = proto.readMessageBegin();
	const tdata = readStruct(proto);
	proto.readMessageEnd();
	return { data: tdata, _info: msg_info };
}

export function readThrift(
	data: Uint8Array | Buffer,
	Protocol: typeof thrift.TCompactProtocol | typeof thrift.TBinaryProtocol =
		thrift.TCompactProtocol,
): ParsedThrift {
	return _readThrift(data, Protocol);
}

export function readThriftStruct(
	data: Uint8Array | Buffer,
	Protocol: typeof thrift.TCompactProtocol | typeof thrift.TBinaryProtocol =
		thrift.TCompactProtocol,
): ThriftStructData {
	const bufTrans = new thrift.TFramedTransport(
		data instanceof Buffer ? data : Buffer.from(data),
	);
	const proto = new Protocol(bufTrans);
	return readStruct(proto);
}

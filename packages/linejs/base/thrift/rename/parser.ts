import type { ParsedThrift } from "../readwrite/declares.ts";

// const TYPE: Record<string, number> = {
// 	STOP: 0,
// 	VOID: 1,
// 	BOOL: 2,
// 	BYTE: 3,
// 	I08: 3,
// 	DOUBLE: 4,
// 	I16: 6,
// 	I32: 8,
// 	I64: 10,
// 	STRING: 11,
// 	UTF7: 11,
// 	STRUCT: 12,
// 	MAP: 13,
// 	SET: 14,
// 	LIST: 15,
// 	UTF8: 16,
// 	UTF16: 17,
// };

/** One field entry of a struct definition from the LINE thrift def. */
interface StructFieldDef {
	fid: string | number;
	name: string;
	struct?: string;
	list?: string | number;
	map?: string | number;
	set?: string | number;
	type?: number;
}

/** A def table entry is either a struct field list or an enum table. */
type DefEntry = Record<string, string> | StructFieldDef[];

function isStruct(value: unknown): value is StructFieldDef[] {
	return Boolean(value) && Array.isArray(value);
}

/**
 * Wire structs arrive from the thrift reader as plain fid-keyed objects.
 * The `typeof value === "object"` runtime branch (which intentionally
 * includes `null` — a for-in over null simply never iterates) is restated
 * here so the checker can follow the fid-keyed access. Never changes
 * runtime behavior.
 */
function isWireStruct(value: unknown): value is Record<string, unknown> {
	return typeof value === "object";
}

/**
 * Restates the `typeof value === "object"` branch on the list/set path.
 * As before, a non-array object (or null) still fails at the
 * `value.forEach` call with the same TypeError at runtime.
 */
function isWireList(value: unknown): value is unknown[] {
	return typeof value === "object";
}

/** Enum tables are plain name-by-fid records. */
function isEnumTable(value: unknown): value is Record<PropertyKey, string> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Only string/number values can hit an enum table key; everything else
 * misses (JS key coercion) and falls back to the raw value, as before. */
function isIndexKey(value: unknown): value is string | number {
	return typeof value === "string" || typeof value === "number";
}

export class ThriftRenameParser {
	def: Record<string, DefEntry> = {};

	#name2fid(structName: string, name: string): StructFieldDef {
		const struct = this.def[structName];
		if (struct && Array.isArray(struct)) {
			const result = struct.findIndex((e) => {
				return e.name == name;
			});
			if (result === -1) {
				return { name: name, fid: -1 };
			} else {
				return struct[result];
			}
		} else {
			return { name: name, fid: -1 };
		}
	}

	#fid2name(structName: string, fid: string): StructFieldDef {
		const struct = this.def[structName];
		if (struct && Array.isArray(struct)) {
			const result = struct.findIndex((e) => {
				return e.fid == fid;
			});
			if (result === -1) {
				return { name: fid, fid: fid };
			} else {
				return struct[result];
			}
		} else {
			return { name: fid, fid: fid };
		}
	}

	rename_thrift(structName: string, object: unknown): unknown {
		if (!isWireStruct(object)) return object;
		const newObject: Record<string, unknown> = {};
		for (const fid in object) {
			const value: unknown = object[fid];
			const finfo = this.#fid2name(structName, fid);
			if (typeof value === "undefined") {
				continue;
			}
			if (
				finfo.struct &&
				(typeof value === "object" || typeof value === "number")
			) {
				if (isStruct(this.def[finfo.struct])) {
					newObject[finfo.name] = this.rename_thrift(
						finfo.struct,
						value,
					);
				} else if (this.def[finfo.struct]) {
					const table = this.def[finfo.struct];
					// Old wire behavior: an untyped keyed lookup on the enum
					// table where any miss (including coerced object keys)
					// falls back to the raw value.
					newObject[finfo.name] = isEnumTable(table) && isIndexKey(value)
						? table[value] || value
						: value;
				} else {
					newObject[finfo.name] = value;
				}
			} else if (
				typeof finfo.list === "string" && isWireList(value)
			) {
				const listStructName = finfo.list;
				const list: unknown[] = [];
				value.forEach((e: unknown, i: number) => {
					list[i] = this.rename_thrift(listStructName, e);
				});
				newObject[finfo.name] = list;
			} else if (
				typeof finfo.map === "string" && isWireStruct(value)
			) {
				const mapped: Record<string, unknown> = {};
				for (const key in value) {
					const e = value[key];
					mapped[key] = this.rename_thrift(finfo.map, e);
				}
				newObject[finfo.name] = mapped;
			} else if (
				typeof finfo.set === "string" && isWireList(value)
			) {
				const setStructName = finfo.set;
				const set: unknown[] = [];
				value.forEach((e: unknown, i: number) => {
					set[i] = this.rename_thrift(setStructName, e);
				});
				newObject[finfo.name] = set;
			} else {
				newObject[finfo.name] = value;
			}
		}
		return newObject;
	}

	rename_data(data: ParsedThrift, square?: boolean): ParsedThrift {
		const name = data._info.fname;
		const struct_name = (square ? "SquareService_" : "") + name + "_result";
		data.data = this.rename_thrift(struct_name, data.data);
		return data;
	}
}

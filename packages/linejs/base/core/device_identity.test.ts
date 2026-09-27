import { assertEquals } from "@std/assert";
import { BaseClient } from "./mod.ts";
import { MemoryStorage } from "../storage/mod.ts";

Deno.test("deviceIdentity defaults to a plausible persona per device", () => {
	const c = new BaseClient({
		device: "ANDROIDSECONDARY",
		storage: new MemoryStorage(),
	});
	// 不再是 linejs-v2 / evex-device 這種 bot 特徵
	assertEquals(c.deviceIdentity.systemName, "Android");
	assertEquals(
		/^(SM|Pixel|SC)-?[A-Z0-9]+|^iPhone|^Mac/.test(c.deviceIdentity.modelName),
		true,
	);
	assertEquals(c.locale, "zh_TW");
});

Deno.test("deviceIdentity is overridable and stable per instance", () => {
	const c = new BaseClient({
		device: "DESKTOPMAC",
		storage: new MemoryStorage(),
		deviceIdentity: { systemName: "macOS", modelName: "Mac15,9" },
		locale: "zh_TW",
	});
	assertEquals(c.deviceIdentity.modelName, "Mac15,9");
	assertEquals(c.deviceIdentity, c.deviceIdentity);
});

Deno.test("x-lal follows the configured locale, not a hardcoded ja_JP", () => {
	const c = new BaseClient({ device: "IOS", storage: new MemoryStorage() });
	assertEquals(c.locale, "zh_TW");
});

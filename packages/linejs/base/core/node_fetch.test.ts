import { assertEquals } from "@std/assert";
import { BaseClient } from "./mod.ts";
import { createNodeFetch } from "./node_fetch.ts";

Deno.test("Node dispatchers are not used on Deno", async () => {
	assertEquals(await createNodeFetch(false)(30_000), null);
	assertEquals(await createNodeFetch(true)(30_000), null);
});

Deno.test("custom fetch handles both RPC and PUSH with cancellation intact", async () => {
	const requests: Request[] = [];
	const client = new BaseClient({
		device: "DESKTOPWIN",
		fetch: (info) => {
			requests.push(new Request(info));
			return Promise.resolve(new Response("ok"));
		},
	});
	const controller = new AbortController();
	await client.fetch("https://example.invalid/rpc", {
		signal: controller.signal,
	});
	await client.fetchPush("https://example.invalid/push", {
		signal: controller.signal,
	});
	assertEquals(requests.length, 2);
	controller.abort();
	assertEquals(requests.map((r) => r.signal.aborted), [true, true]);
});

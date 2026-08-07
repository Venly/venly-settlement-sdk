import { test } from "node:test";
import assert from "node:assert/strict";
import { VenlyFinanceClient } from "@venlyfinance/sdk";
import { proxyClientOptions } from "../src/proxy.js";

test("proxy options never leak a real secret and route through the proxy base", async () => {
  const seen: { url: string; auth: string | undefined }[] = [];
  const fakeBackend: typeof fetch = async (input, init) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers = new Headers(init?.headers ?? (typeof input === "object" && "headers" in input ? input.headers : undefined));
    seen.push({ url, auth: headers.get("authorization") ?? undefined });
    return Response.json({ success: true, result: [], pagination: undefined });
  };

  const proxy = proxyClientOptions("https://app.example.com/api/venly", { fetch: fakeBackend });
  assert.equal((proxy.finance as { clientSecret?: string }).clientSecret, "venly-proxy");

  const client = new VenlyFinanceClient(proxy.finance);
  await client.parties.list();

  // The synthetic token flow never reached the backend...
  assert.ok(seen.every((s) => !s.url.includes("__venly-proxy-token")));
  // ...and the API call went to the proxy base with the synthetic bearer.
  const apiCall = seen.find((s) => s.url.includes("/api/venly/finance/parties"));
  assert.ok(apiCall, `calls seen: ${seen.map((s) => s.url).join(", ")}`);
  assert.equal(apiCall!.auth, "Bearer venly-proxy");
});

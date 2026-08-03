import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "../src/server.js";
import { SdkVenlyClient } from "../src/client/sdk-client.js";
import { MockVenlyClient } from "./helpers.ts";

// The write gate auto-arms in mock mode, so a mock VENLY_ENV wrapped around a
// live client would execute un-gated writes. createServer must refuse the
// mismatch instead of trusting the caller to keep the two aligned.

test("createServer rejects a client whose environment disagrees with VENLY_ENV", () => {
  const mockClient = SdkVenlyClient.mock();
  assert.throws(
    () => createServer({ client: mockClient, env: { VENLY_ENV: "staging" } }),
    /write gate and client must agree on the environment/,
  );
});

test("createServer accepts a client that matches VENLY_ENV", async () => {
  const server = createServer({
    client: SdkVenlyClient.mock(),
    env: { VENLY_ENV: "mock" },
  });
  await server.close();
});

test("createServer tolerates clients that do not declare an environment", async () => {
  // Test doubles (and any legacy VenlyClient implementation) carry no
  // environment marker; the gate env alone governs them, as before.
  const server = createServer({
    client: new MockVenlyClient(),
    env: { VENLY_ENV: "mock" },
  });
  await server.close();
});

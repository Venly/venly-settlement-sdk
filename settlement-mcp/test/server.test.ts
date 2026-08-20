import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "../src/server.js";
import { SdkVenlyClient } from "../src/client/sdk-client.js";
import { MockVenlyClient } from "./helpers.ts";

const EXPECTED_INSTRUCTIONS = `Venly Finance build advisor. This server is a build-time advisor, not your app's data plane. The data plane is the published packages: every read is a hook and every regulated lifecycle a flow machine from \`@venlyfinance/react\`, inside \`<VenlyProvider environment="mock">\` – zero credentials, zero network; server-side code uses \`@venlyfinance/sdk\`. Hand-rolled fetch layers, in-memory money stores, or route handlers that re-implement transfers, balances, or approvals are off-contract and fail review. UI installs from the @venlyfinance shadcn registry: \`npx shadcn@latest add @venlyfinance/balances @venlyfinance/send …\` (auto-installs the npm packages). Before scaffolding, read \`venly://frontend/agents\` – it is the composition doctrine (AGENTS.md). Consult \`get_journey_blueprint\` per screen; gate finished screens with \`review_screen\` and \`npx @venlyfinance/settlement-mcp review "src/**/*.tsx"\`.`;

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

test("initialize response pushes the build-time runtime contract instructions", async () => {
  const server = createServer({
    client: new MockVenlyClient(),
    env: { VENLY_ENV: "mock" },
  });
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "instructions-test", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  assert.equal(client.getInstructions(), EXPECTED_INSTRUCTIONS);

  await client.close();
  await server.close();
});

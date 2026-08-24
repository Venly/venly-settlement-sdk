import assert from "node:assert/strict";
import test from "node:test";
import {
  EXPECTED_PROMPTS,
  EXPECTED_RESOURCE_URIS,
  EXPECTED_TOOLS,
  assertSandboxRefusal,
  assertExpectedDiscovery,
  buildStagingChildEnv,
} from "../src/staging-smoke.js";
import { makeHarness } from "./helpers.ts";

test("staging smoke expectations match the runtime MCP surface", async () => {
  const h = await makeHarness({});
  try {
    const [toolResult, resourceResult, promptResult] = await Promise.all([
      h.client.listTools(),
      h.client.listResources(),
      h.client.listPrompts(),
    ]);
    assert.doesNotThrow(() =>
      assertExpectedDiscovery({
        tools: toolResult.tools.map((tool) => tool.name),
        resources: resourceResult.resources.map((resource) => resource.uri),
        prompts: promptResult.prompts.map((prompt) => prompt.name),
      }),
    );
  } finally {
    await h.close();
  }
});

test("staging smoke accepts only the complete expected MCP surface", () => {
  assert.doesNotThrow(() =>
    assertExpectedDiscovery({
      tools: [...EXPECTED_TOOLS],
      resources: [...EXPECTED_RESOURCE_URIS],
      prompts: [...EXPECTED_PROMPTS],
    }),
  );

  assert.throws(
    () =>
      assertExpectedDiscovery({
        tools: EXPECTED_TOOLS.filter((name) => name !== "create_party"),
        resources: [...EXPECTED_RESOURCE_URIS],
        prompts: [...EXPECTED_PROMPTS],
      }),
    /missing tool: create_party/,
  );
});

test("staging smoke accepts a refused confirmed write that states the boundary", () => {
  assert.doesNotThrow(() =>
    assertSandboxRefusal({
      isError: true,
      content: [
        {
          type: "text",
          text: "Error: create_party refused: … the mock sandbox … No request was sent.",
        },
      ],
    }),
  );
});

test("staging smoke rejects a write that executed", () => {
  assert.throws(
    () =>
      assertSandboxRefusal({
        mode: "live",
        environment: "staging",
        result: { id: "party-1" },
      }),
    /expected the staging write to be refused/,
  );
});

test("staging smoke rejects a refusal that does not state the sandbox boundary", () => {
  assert.throws(
    () =>
      assertSandboxRefusal({
        isError: true,
        content: [{ type: "text", text: "Error: something else went wrong" }],
      }),
    /state the sandbox boundary/,
  );
});

test("staging smoke strips parent live-write flags before spawning", () => {
  const childEnv = buildStagingChildEnv({
    PATH: "/usr/bin",
    VENLY_ENV: "production",
    VENLY_CLIENT_ID: "staging-client",
    VENLY_CLIENT_SECRET: "staging-secret",
    VENLY_MCP_LIVE: "1",
    VENLY_MCP_PRODUCTION: "1",
  });

  assert.equal(childEnv.VENLY_ENV, "staging");
  assert.equal(childEnv.VENLY_CLIENT_ID, "staging-client");
  assert.equal(childEnv.VENLY_CLIENT_SECRET, "staging-secret");
  assert.equal(childEnv.VENLY_MCP_LIVE, undefined);
  assert.equal(childEnv.VENLY_MCP_PRODUCTION, undefined);
});

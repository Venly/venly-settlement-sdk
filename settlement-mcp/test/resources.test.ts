import assert from "node:assert/strict";
import test from "node:test";
import { makeHarness } from "./helpers.ts";

const EXPECTED_URIS = [
  "venly://capabilities",
  "venly://safety",
  "venly://workflows/international-account",
  "venly://workflows/mock-to-staging",
];

test("builder resources enumerate at stable Venly URIs", async () => {
  const h = await makeHarness({});
  const { resources } = await h.client.listResources();
  assert.deepEqual(
    resources.map((resource) => resource.uri).sort(),
    [...EXPECTED_URIS].sort(),
  );
  await h.close();
});
test("capabilities resource states supported and unsupported product boundaries", async () => {
  const h = await makeHarness({});
  const result = await h.client.readResource({ uri: "venly://capabilities" });
  const text = String(result.contents[0]?.text ?? "");
  assert.match(text, /party/i);
  assert.match(text, /wallet balances/i);
  assert.match(text, /EUR.*SEPA/i);
  assert.match(text, /card issuing.*not exposed/i);
  assert.match(text, /regulated partners/i);
  await h.close();
});

test("safety and workflow resources preserve compliance and environment gates", async () => {
  const h = await makeHarness({});
  const safety = await h.client.readResource({ uri: "venly://safety" });
  const workflow = await h.client.readResource({
    uri: "venly://workflows/international-account",
  });
  const mockToStaging = await h.client.readResource({
    uri: "venly://workflows/mock-to-staging",
  });
  const safetyText = String(safety.contents[0]?.text ?? "");
  const workflowText = String(workflow.contents[0]?.text ?? "");
  const transitionText = String(mockToStaging.contents[0]?.text ?? "");

  assert.match(safetyText, /KYC.*VERIFIED/i);
  assert.match(safetyText, /VENLY_MCP_PRODUCTION=1/);
  assert.match(workflowText, /create_party[\s\S]*create_account[\s\S]*list_wallets/);
  assert.match(workflowText, /create_virtual_bank_account/);
  assert.match(transitionText, /no implicit fallback/i);
  assert.match(transitionText, /credentials/i);
  await h.close();
});

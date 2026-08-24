import assert from "node:assert/strict";
import test from "node:test";
import { makeHarness } from "./helpers.ts";

const EXPECTED_URIS = [
  "venly://capabilities",
  "venly://safety",
  "venly://workflows/international-account",
  "venly://workflows/mock-to-staging",
  "venly://frontend/agents",
];

function firstText(
  result: { contents: Array<{ text: string } | { blob: string }> },
): string {
  const content = result.contents[0];
  assert.ok(content && "text" in content, "expected a text resource");
  return content.text;
}

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
  const text = firstText(result);
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
  const safetyText = firstText(safety);
  const workflowText = firstText(workflow);
  const transitionText = firstText(mockToStaging);

  assert.match(safetyText, /KYC.*VERIFIED/i);
  assert.match(safetyText, /refuses any non-sandbox base URL and any credential-shaped parameter/);
  assert.match(safetyText, /READS only/);
  assert.match(workflowText, /create_party[\s\S]*create_account[\s\S]*list_wallets/);
  assert.match(workflowText, /create_virtual_bank_account/);
  assert.match(transitionText, /no implicit fallback/i);
  assert.match(transitionText, /credentials/i);
  await h.close();
});

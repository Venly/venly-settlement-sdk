import assert from "node:assert/strict";
import test from "node:test";
import { makeHarness } from "./helpers.ts";

test("international-account builder prompt enumerates and renders product guardrails", async () => {
  const h = await makeHarness({});
  const { prompts } = await h.client.listPrompts();
  assert.ok(prompts.some((prompt) => prompt.name === "build_international_account"));

  const result = await h.client.getPrompt({
    name: "build_international_account",
    arguments: {
      productName: "Acme Global",
      customerType: "organisation",
      targetGeography: "Belgium and the UK",
    },
  });
  const text = result.messages
    .map((message) => (message.content.type === "text" ? message.content.text : ""))
    .join("\n");

  assert.match(text, /Acme Global/);
  assert.match(text, /start in explicit mock mode/i);
  assert.match(text, /@venlyfinance\/sdk/);
  assert.match(text, /server[- ]side/i);
  assert.match(text, /do not claim.*KYC/i);
  assert.match(text, /explicit user.*staging/i);
  // The server refuses non-mock targets on every write and prepare tool; it has no
  // dry-run mode, so the brief must not promise one (contract question Q7).
  assert.doesNotMatch(text, /dry-run staging mutations/i);
  assert.match(text, /there is no dry-run mode/i);
  assert.match(text, /refuses a non-mock target at the sandbox boundary/i);
  assert.match(text, /regulated partners/i);
  assert.match(text, /card issuing.*not exposed/i);
  await h.close();
});

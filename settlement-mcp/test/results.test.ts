import assert from "node:assert/strict";
import test from "node:test";
import { errorResult } from "../src/results.ts";
import { callToolJson, makeHarness } from "./helpers.ts";

test("read and write tools return text plus machine-readable structuredContent", async () => {
  const h = await makeHarness({ VENLY_ENV: "mock" });
  const account = await callToolJson(h.client, "get_account", { accountId: "acct-1" });
  const party = await callToolJson(h.client, "create_party", {
    partyType: "ORGANISATION",
    name: "Acme",
  });

  assert.equal(account.raw.structuredContent.id, "acct-1");
  assert.equal(party.raw.structuredContent.mode, "mock");
  assert.equal(party.raw.structuredContent.result.id, "party-created-1");
  assert.match(account.raw.content[0].text, /acct-1/);
  await h.close();
});
test("error result redacts bearer and client-secret material", () => {
  const result = errorResult(
    "request failed Authorization: Bearer secret-token client_secret=super-secret",
  );
  const text = String(result.content[0]?.text ?? "");
  assert.doesNotMatch(text, /secret-token|super-secret/);
  assert.match(text, /\[REDACTED\]/);
});

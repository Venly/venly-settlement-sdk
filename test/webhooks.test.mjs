// Webhooks (public plane, full lifecycle): GET/POST /webhooks,
// GET/PUT/DELETE /webhooks/{webhookId}, POST /webhooks/{webhookId}/ping.
// The two contract facts these tests pin down:
//  - createWebhook has NO idempotent-create semantics (no body field, no
//    header parameter) - a replayed create mints a SECOND webhook.
//  - apiKey/password are write-only: no read ever returns a stored secret.
import test from "node:test";
import assert from "node:assert/strict";
import { VenlyFinanceClient, VenlyApiError, demoCast } from "../dist/esm/index.js";

const mockFinance = () => new VenlyFinanceClient({ environment: "mock" });

const API_KEY_METHOD = {
  type: "ApiKeyAuthenticationMethod",
  headerName: "X-Api-Key",
  apiKey: "sk-live-verylongsecret-91d7",
};

const BASIC_METHOD = {
  type: "BasicAuthenticationMethod",
  username: "events-consumer",
  password: "hunter2-hunter2",
};

test("webhooks: create -> list -> get -> update -> delete round-trips", async () => {
  const f = mockFinance();

  const empty = await f.webhooks.list();
  assert.equal(empty.resultPresent, true);
  assert.equal(empty.items.length, 0, "base seeds register no webhook");

  const created = await f.webhooks.create({
    url: "https://example.com/hooks/settlements",
    name: "Settlement events",
    authenticationMethod: API_KEY_METHOD,
  });
  assert.ok(created.id);
  assert.equal(created.status, "ACTIVE", "the contract's status enum has one member");

  const listed = await f.webhooks.list();
  assert.equal(listed.items.length, 1);
  assert.equal((await f.webhooks.get(created.id)).url, "https://example.com/hooks/settlements");

  const updated = await f.webhooks.update(created.id, {
    url: "https://example.com/hooks/settlements-v2",
    authenticationMethod: BASIC_METHOD,
  });
  assert.equal(updated.url, "https://example.com/hooks/settlements-v2");
  assert.equal(updated.authenticationMethod.type, "BasicAuthenticationMethod");

  await f.webhooks.delete(created.id);
  assert.equal((await f.webhooks.list()).items.length, 0);
  await assert.rejects(
    () => f.webhooks.get(created.id),
    (e) => e instanceof VenlyApiError && e.status === 404,
  );
});

test("webhooks: create has NO idempotency envelope - a replay mints a second webhook", async () => {
  const f = mockFinance();
  const body = {
    url: "https://example.com/hooks/replayed",
    name: "Replayed registration",
    authenticationMethod: API_KEY_METHOD,
  };
  // Identical body, identical explicit idempotency key: on the money-moving
  // endpoints this replays; here the contract defines no such semantics.
  const key = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
  const first = await f.webhooks.create(body, { idempotencyKey: key });
  const second = await f.webhooks.create(body, { idempotencyKey: key });
  assert.notEqual(first.id, second.id, "a replayed create registers a second webhook");
  const page = await f.webhooks.list();
  assert.equal(page.items.length, 2, "both registrations exist");
});

test("webhooks: no read ever returns a stored secret (write-only fields masked)", async () => {
  const f = mockFinance();
  const created = await f.webhooks.create({
    url: "https://example.com/hooks/masked",
    authenticationMethod: API_KEY_METHOD,
  });
  assert.ok(!created.authenticationMethod.apiKey.includes("verylongsecret"));
  assert.equal(created.authenticationMethod.apiKey, "••••91d7");

  const read = await f.webhooks.get(created.id);
  assert.ok(!JSON.stringify(read).includes("verylongsecret"));

  const updated = await f.webhooks.update(created.id, {
    url: "https://example.com/hooks/masked",
    authenticationMethod: BASIC_METHOD,
  });
  assert.ok(!JSON.stringify(updated).includes("hunter2"));
  assert.equal(updated.authenticationMethod.password, "••••ter2");
  assert.equal(updated.authenticationMethod.username, "events-consumer");
});

test("webhooks: validation - url must be https, auth method must be a known variant", async () => {
  const f = mockFinance();
  await assert.rejects(
    () =>
      f.webhooks.create({ url: "http://example.com/insecure", authenticationMethod: API_KEY_METHOD }),
    (e) => e instanceof VenlyApiError && e.status === 400,
  );
  await assert.rejects(
    () =>
      f.webhooks.create({
        url: "https://example.com/hooks",
        authenticationMethod: { type: "TOKEN" },
      }),
    (e) => e instanceof VenlyApiError && e.status === 400,
  );
  // The base schema's enum spelling is accepted as an input alias and
  // normalised to the generated literal on the way out.
  const aliased = await f.webhooks.create({
    url: "https://example.com/hooks/alias",
    authenticationMethod: { type: "API_KEY", headerName: "X-Api-Key", apiKey: "abcd1234" },
  });
  assert.equal(aliased.authenticationMethod.type, "ApiKeyAuthenticationMethod");
});

test("webhooks: ping resolves the contract's void envelope, verbatim-renderable", async () => {
  const f = mockFinance();
  const created = await f.webhooks.create({
    url: "https://example.com/hooks/ping",
    authenticationMethod: API_KEY_METHOD,
  });
  const result = await f.webhooks.ping(created.id);
  assert.equal(result.success, true);
  await assert.rejects(
    () => f.webhooks.ping("no-such-webhook"),
    (e) => e instanceof VenlyApiError && e.status === 404,
  );
});

test("webhooks: the delivery log records business events for ACTIVE webhooks only", async () => {
  const f = mockFinance();
  const sims = f.mock.simulations;
  const created = await f.webhooks.create({
    url: "https://example.com/hooks/deliveries",
    authenticationMethod: API_KEY_METHOD,
  });

  // Drive a business event: an account verification decision.
  const accounts = await f.accounts.list();
  const target = accounts.items.find((a) => a.kycStatus === "VERIFICATION_PENDING");
  sims.verification.advance(target.id, "VERIFIED");

  const log = sims.webhookDeliveries.list(created.id);
  assert.ok(log.length >= 1, "the decision was delivered to the registered webhook");
  const delivery = log.find((d) => d.eventType === "account.verification_changed");
  assert.ok(delivery, "the delivery names the event type");
  assert.equal(delivery.webhookId, created.id);
  assert.equal(delivery.status, "DELIVERED");
  assert.ok(delivery.at, "the delivery carries its timestamp");

  // store.* events are replication plumbing, never deliveries.
  sims.reset();
  const afterReset = sims.webhookDeliveries.list();
  assert.equal(afterReset.length, 0, "reset clears the log and records no store.* delivery");
});

test("webhooks: demoCast seeds one ACTIVE webhook at a reserved example URL, secret masked", async () => {
  const f = mockFinance();
  f.mock.simulations.seed(demoCast);
  const page = await f.webhooks.list();
  assert.equal(page.items.length, 1);
  const seeded = page.items[0];
  assert.equal(seeded.status, "ACTIVE");
  assert.ok(new URL(seeded.url).hostname.endsWith("example.com"), "clearly-fake URL");
  assert.ok(seeded.authenticationMethod.apiKey.startsWith("••••"), "seeded secret is masked");
});

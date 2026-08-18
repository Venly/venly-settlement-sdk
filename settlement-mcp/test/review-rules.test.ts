/**
 * The extended review_screen rule set: cross-cutting mechanisms
 * (suppression hatch, comment-line skipping, journey scoping) and the
 * five rule classes covering invented timing copy, crypto currency
 * formatting crashes, required-fields-rendered-optional, blueprint state
 * coverage and fixture honesty.
 *
 * Every rule ships one fires-on fixture and one must-not-fire fixture:
 * a design linter that cries wolf gets switched off, so false-positive
 * coverage is as load-bearing as detection.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { reviewScreenSource } from "../src/frontend.js";

const rulesOf = (findings: ReturnType<typeof reviewScreenSource>, rule: string) =>
  findings.filter((f) => f.rule === rule);

// ---------------------------------------------------------------------------
// Mechanism: venly-allow:<rule-id> suppression applies to the existing rules
// ---------------------------------------------------------------------------

test("suppression: venly-allow on the offending line silences an existing rule", () => {
  const src = `<div style="color: #ff0000">x</div> {/* venly-allow:raw-colour */}`;
  assert.equal(rulesOf(reviewScreenSource(src), "raw-colour").length, 0);
});

test("suppression: venly-allow on the line above silences the finding", () => {
  const src = `{/* venly-allow:raw-colour */}\n<div style="color: #ff0000">x</div>`;
  assert.equal(rulesOf(reviewScreenSource(src), "raw-colour").length, 0);
});

test("suppression: is per rule id - other rules on the same line still fire", () => {
  const src = `{/* venly-allow:raw-colour */}\n<span style="color: #ff0000">-4,890.25 EUR</span>`;
  const findings = reviewScreenSource(src);
  assert.equal(rulesOf(findings, "raw-colour").length, 0);
  assert.equal(rulesOf(findings, "hyphen-minus-amount").length, 1);
});

test("suppression: two lines below the token, the finding fires again", () => {
  const src = `{/* venly-allow:raw-colour */}\n\n<div style="color: #ff0000">x</div>`;
  assert.equal(rulesOf(reviewScreenSource(src), "raw-colour").length, 1);
});

// ---------------------------------------------------------------------------
// Mechanism: the journey parameter is optional and additive
// ---------------------------------------------------------------------------

test("journey: omitting the parameter never produces blueprint findings", () => {
  const findings = reviewScreenSource(`<div>anything at all</div>`);
  assert.equal(rulesOf(findings, "blueprint-state-missing").length, 0);
});

test("invented-timing-claim fires once per invented promise in copy", () => {
  const findings = reviewScreenSource(
    `<p>Funds typically arrive within 1-2 business days.</p>`,
  ).filter((f) => f.rule === "invented-timing-claim");
  // Two independent matches in the sentence: the adverb+verb claim and the range claim.
  assert.equal(findings.length, 2);
  assert.deepEqual(
    findings.map((f) => f.evidence),
    ["typically arrive", "1-2 business days"],
  );
  assert.equal(findings[0].severity, "error");
  assert.equal(
    findings[0].fix,
    "No API in this stack returns a duration, settlement window or custody guarantee. Render the labelled omission the contract specifies, or - if your own API does return it - name the field path on the line and add venly-allow:invented-timing-claim.",
  );
});

test("invented-timing-claim stays quiet on integrator SLA fields and bare time units", () => {
  const source = [
    `// venly-allow:invented-timing-claim - integrator's own SLA field`,
    `<p>Arrives {sla.window}</p>`,
    `<Th>Age in days</Th>`,
  ].join("\n");
  assert.equal(
    reviewScreenSource(source).filter((f) => f.rule === "invented-timing-claim").length,
    0,
  );
});

test("invented-timing-claim skips comment lines - comments are not copy", () => {
  const source = `// never write copy like "typically arrives" or "estimated arrival" here`;
  assert.equal(
    reviewScreenSource(source).filter((f) => f.rule === "invented-timing-claim").length,
    0,
  );
});

test("venly-allow:invented-timing-claim on the line above drops the finding", () => {
  const source = [
    `{/* venly-allow:invented-timing-claim - rendered from partner.sla.windowDays */}`,
    `<p>Funds typically arrive within 1-2 business days.</p>`,
  ].join("\n");
  assert.equal(
    reviewScreenSource(source).filter((f) => f.rule === "invented-timing-claim").length,
    0,
  );
});

test("venly-allow:invented-timing-claim on the same line drops the finding", () => {
  const source = `<p>Held until claimed per {custody.policyField}</p> // venly-allow:invented-timing-claim`;
  assert.equal(
    reviewScreenSource(source).filter((f) => f.rule === "invented-timing-claim").length,
    0,
  );
});

test("intl-currency-crypto: literal crypto code with style:currency is an error", () => {
  const source = `const f = new Intl.NumberFormat("en-US", { style: "currency", currency: "USDC" });`;
  const findings = reviewScreenSource(source).filter((f) => f.rule === "intl-currency-crypto");
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "error");
  assert.equal(
    findings[0].fix,
    "Intl.NumberFormat with style:\"currency\" throws RangeError on a non-ISO-4217 code. Render crypto amounts with the Money primitive, which places the code beside the digits instead of inside the formatter.",
  );
  assert.match(findings[0].evidence, /USDC/);
});

test("intl-currency-crypto: variable-fed currency with style:currency is a warn (not an error)", () => {
  const source = `const f = new Intl.NumberFormat("en-US", { style: "currency", currency: asset });`;
  const findings = reviewScreenSource(source).filter((f) => f.rule === "intl-currency-crypto");
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "warn");
  assert.equal(
    findings[0].fix,
    "This formatter takes its currency from a variable. If a crypto asset can reach it, it throws at runtime. Use the Money primitive, or narrow the variable to ISO-4217 codes.",
  );
});

test("intl-currency-crypto: does not fire on the kit's own plain decimal formatter", () => {
  // Mirrors ui/registry/lib/money.tsx - no style:"currency", so no RangeError risk.
  const source = [
    `const formatted = new Intl.NumberFormat("en-US", {`,
    `  minimumFractionDigits: 2,`,
    `  maximumFractionDigits: 2,`,
    `}).format(Math.abs(amount));`,
  ].join("\n");
  const findings = reviewScreenSource(source).filter((f) => f.rule === "intl-currency-crypto");
  assert.equal(findings.length, 0);
});

test("intl-currency-crypto: does not fire on a literal ISO-4217 currency", () => {
  const source = `const f = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });`;
  const findings = reviewScreenSource(source).filter((f) => f.rule === "intl-currency-crypto");
  assert.equal(findings.length, 0);
});

test("intl-currency-crypto: venly-allow on the line above suppresses the finding", () => {
  const source = [
    `// venly-allow:intl-currency-crypto`,
    `const f = new Intl.NumberFormat("en-US", { style: "currency", currency: "USDC" });`,
  ].join("\n");
  const findings = reviewScreenSource(source).filter((f) => f.rule === "intl-currency-crypto");
  assert.equal(findings.length, 0);
});

test("intl-currency-crypto: venly-allow on the same line suppresses the finding", () => {
  const source = `const f = new Intl.NumberFormat("en-US", { style: "currency", currency: asset }); // venly-allow:intl-currency-crypto`;
  const findings = reviewScreenSource(source).filter((f) => f.rule === "intl-currency-crypto");
  assert.equal(findings.length, 0);
});

const RRO = "required-rendered-optional";
const rro = (source: string) =>
  reviewScreenSource(source).filter((f) => f.rule === RRO);

test("required-rendered-optional: fires when the payment reference is labelled (not required)", () => {
  const source = `<FieldRow label="Payment reference (not required)" value={vba.referenceCode} />`;
  const findings = rro(source);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "error");
  assert.equal(
    findings[0].fix,
    'The payment reference is required - a payer who omits it produces an unmatched credit. Render the amber Required pill; never label it "(not required)".',
  );
});

test("required-rendered-optional: does not fire on a genuinely optional row (BIC)", () => {
  const source = `<FieldRow label="BIC (not required)" value={vba.bic} />`;
  assert.equal(rro(source).length, 0);
});

test("required-rendered-optional: does not fire on a comment that documents the contract", () => {
  const source = `{/* A required field can never read "(not required)": a missing reference is a
    blocker, not an optional row. */}
<FieldRow label="Payment reference" value={vba.referenceCode} required />`;
  assert.equal(rro(source).length, 0);
});

test("required-rendered-optional: does not fire when 'reference' only appears in a nearby comment", () => {
  const source = `// The payment reference row above is handled elsewhere.
<FieldRow label="BIC (not required)" value={vba.bic} />`;
  assert.equal(rro(source).length, 0);
});

test("required-rendered-optional: venly-allow on the line above suppresses the finding", () => {
  const source = `// venly-allow:required-rendered-optional
<FieldRow label="Payment reference (not required)" value={vba.referenceCode} />`;
  assert.equal(rro(source).length, 0);
});

test("required-rendered-optional: venly-allow on the same line suppresses the finding", () => {
  const source = `<FieldRow label="Payment reference (not required)" value={vba.referenceCode} /> {/* venly-allow:required-rendered-optional */}`;
  assert.equal(rro(source).length, 0);
});

test("blueprint-state-missing: fires when a receive-journey source lacks a blueprint state keyword", () => {
  const src = [
    "export function ReceiveScreen() {",
    "  return (",
    "    <section>",
    "      <p>details present</p>",
    "      <p>reference not yet assigned</p>",
    "    </section>",
    "  );",
    "}",
  ].join("\n");
  const findings = reviewScreenSource(src, "receive").filter(
    (f) => f.rule === "blueprint-state-missing",
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "warn");
  assert.equal(findings[0].evidence, "no virtual bank account yet");
  assert.equal(
    findings[0].fix,
    "The receive blueprint names 3 states. These were not found by name in this source: no virtual bank account yet. Either they are missing or they render under different wording - check each by hand.",
  );
});

test("blueprint-state-missing: silent when every receive blueprint state keyword is present", () => {
  const src = [
    "export function ReceiveScreen() {",
    "  // branches: no virtual bank account yet, details present, reference not yet assigned",
    "  return <section>receive</section>;",
    "}",
  ].join("\n");
  const findings = reviewScreenSource(src, "receive").filter(
    (f) => f.rule === "blueprint-state-missing",
  );
  assert.equal(findings.length, 0);
});

test("blueprint-state-missing: never runs when journey is undefined", () => {
  const src = [
    "export function ReceiveScreen() {",
    "  return <p>details present</p>;",
    "}",
  ].join("\n");
  const findings = reviewScreenSource(src).filter(
    (f) => f.rule === "blueprint-state-missing",
  );
  assert.equal(findings.length, 0);
});

test("blueprint-state-missing: venly-allow token anywhere in the source suppresses the finding", () => {
  const src = [
    "export function ReceiveScreen() {",
    "  // venly-allow:blueprint-state-missing - states render under different wording",
    "  return (",
    "    <section>",
    "      <p>details present</p>",
    "      <p>reference not yet assigned</p>",
    "    </section>",
    "  );",
    "}",
  ].join("\n");
  const findings = reviewScreenSource(src, "receive").filter(
    (f) => f.rule === "blueprint-state-missing",
  );
  assert.equal(findings.length, 0);
});

test("parity-fixture: fires on exchangeRate: 1", () => {
  const src = `const quote = { exchangeRate: 1 };`;
  const findings = reviewScreenSource(src).filter((f) => f.rule === "parity-fixture");
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "error");
  assert.equal(findings[0].evidence, "exchangeRate: 1");
  assert.equal(
    findings[0].fix,
    "A parity exchange rate makes the crypto/fiat unit distinction numerically invisible, which is the falsehood a real quoted rate exists to prevent. Seed a real non-parity rate.",
  );
});

test("parity-fixture: fires on rate: 1.00", () => {
  const src = `const fx = { rate: 1.00 };`;
  const findings = reviewScreenSource(src).filter((f) => f.rule === "parity-fixture");
  assert.equal(findings.length, 1);
  assert.equal(findings[0].evidence, "rate: 1.00");
});

test("parity-fixture: must not fire on non-parity rates or unrelated names", () => {
  const src = [
    `const quote = { exchangeRate: 0.92 };`,
    `const cfg = { rateLimit: 1 };`,
  ].join("\n");
  const findings = reviewScreenSource(src).filter((f) => f.rule === "parity-fixture");
  assert.equal(findings.length, 0);
});

test("parity-fixture: venly-allow on the line above suppresses the finding", () => {
  const src = [
    `// venly-allow:parity-fixture`,
    `const quote = { exchangeRate: 1 };`,
  ].join("\n");
  const findings = reviewScreenSource(src).filter((f) => f.rule === "parity-fixture");
  assert.equal(findings.length, 0);
});

test("parity-fixture: venly-allow on the same line suppresses the finding", () => {
  const src = `const quote = { exchangeRate: 1 }; /* venly-allow:parity-fixture */`;
  const findings = reviewScreenSource(src).filter((f) => f.rule === "parity-fixture");
  assert.equal(findings.length, 0);
});

test("round-number-coincidence: three .00 amounts on code lines produce one warn naming the count", () => {
  const src = [
    `const rows = [12.34, 40.00, 25.00];`,
    `const total = 65.00;`,
  ].join("\n");
  const findings = reviewScreenSource(src).filter(
    (f) => f.rule === "round-number-coincidence",
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "warn");
  assert.ok(findings[0].evidence.includes("3"));
  assert.equal(
    findings[0].fix,
    "Round-number fixtures hide arithmetic. If a total is coincidentally equal to a part, the screen teaches a false pattern - use amounts that do not divide evenly.",
  );
});

test("round-number-coincidence: must not fire on two code-line matches", () => {
  const src = [
    `const rows = [40.00, 25.13];`,
    `const total = 65.00;`,
  ].join("\n");
  const findings = reviewScreenSource(src).filter(
    (f) => f.rule === "round-number-coincidence",
  );
  assert.equal(findings.length, 0);
});

test("round-number-coincidence: matches on comment lines do not count toward the threshold", () => {
  const src = [
    `// totals seen in QA: 10.00 20.00 30.00 40.00`,
    `const a = 40.00;`,
    `const b = 25.00;`,
  ].join("\n");
  const findings = reviewScreenSource(src).filter(
    (f) => f.rule === "round-number-coincidence",
  );
  assert.equal(findings.length, 0);
});

test("round-number-coincidence: venly-allow on the line above the first counted match suppresses it", () => {
  const src = [
    `// venly-allow:round-number-coincidence`,
    `const a = 40.00, b = 25.00, c = 65.00;`,
  ].join("\n");
  const findings = reviewScreenSource(src).filter(
    (f) => f.rule === "round-number-coincidence",
  );
  assert.equal(findings.length, 0);
});

test("blueprint-state-missing: parenthetical commas never become state keywords", () => {
  // The send blueprint's last state is "failed (reason shown, terminal)" -
  // a naive comma split yields the garbage keyword "terminal)" which no
  // source can contain, making the journey structurally unable to pass.
  const complete = `
    type Phase = "draft" | "staged review" | "submitting" | "pending" | "completed" | "failed";
  `;
  const findings = reviewScreenSource(complete, "send").filter(
    (f) => f.rule === "blueprint-state-missing",
  );
  assert.deepEqual(findings, [], "a source naming every send state must pass");
});

test("blueprint-state-missing: reports genuinely absent states with the journey's true count", () => {
  const partial = `type Phase = "draft" | "submitting";`;
  const findings = reviewScreenSource(partial, "send").filter(
    (f) => f.rule === "blueprint-state-missing",
  );
  assert.equal(findings.length, 1);
  assert.match(findings[0].fix, /The send blueprint names 6 states/);
  assert.ok(!findings[0].evidence.includes(")"), "no parser artifacts in the missing list");
});

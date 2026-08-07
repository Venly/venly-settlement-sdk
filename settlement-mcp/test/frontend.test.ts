import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { reviewScreenSource, REGISTRY_URL_TEMPLATE } from "../src/frontend.js";

test("review_screen: raw colours are errors", () => {
  const findings = reviewScreenSource(`<div style="color: #ff0000; background: rgba(0,0,0,0.5)">x</div>`);
  const rules = findings.map((f) => f.rule);
  assert.equal(rules.filter((r) => r === "raw-colour").length, 2);
  assert.ok(findings.every((f) => f.fix.length > 10));
});

test("review_screen: hyphen-minus before a currency amount is an error", () => {
  const findings = reviewScreenSource(`<span>-4,890.25 EUR</span>`);
  assert.ok(findings.some((f) => f.rule === "hyphen-minus-amount"));
  // The true minus sign passes.
  assert.equal(
    reviewScreenSource(`<span>−4,890.25 EUR</span>`).filter((f) => f.rule === "hyphen-minus-amount").length,
    0,
  );
});

test("review_screen: success styling near a cancelled step is an error", () => {
  const findings = reviewScreenSource(
    `<li>Cancelled <span style="color: var(--state-success-fg)">✓</span></li>`,
  );
  assert.ok(findings.some((f) => f.rule === "success-on-cancelled"));
});

test("review_screen: the success-on-cancelled rule ignores prose, comments and token names", () => {
  // The verb "cancel" in prose near a checkmark is not a rendered state.
  const prose = reviewScreenSource(
    `// user can cancel this at any time. Later: render a ✓ when the upload finishes`,
  );
  assert.equal(prose.filter((f) => f.rule === "success-on-cancelled").length, 0);

  // A token file's comment mentioning Cancelled near --state-success-* is
  // not a violation either - the kit's own tokens.css must pass.
  const tokens = readFileSync(
    new URL("../../ui/registry/styles/tokens.css", import.meta.url),
    "utf8",
  );
  const findings = reviewScreenSource(tokens).filter((f) => f.rule === "success-on-cancelled");
  assert.deepEqual(findings, [], "tokens.css must pass its own audit");

  // A rendered Cancelled label with a checkmark nearby IS the violation.
  const real = reviewScreenSource(`<li><span>Cancelled</span> <span aria-hidden="true">✓</span></li>`);
  assert.ok(real.some((f) => f.rule === "success-on-cancelled"));
});

test("review_screen: masked values on a review screen are an error", () => {
  const findings = reviewScreenSource(`<h2>Review transfer</h2><span>••••••</span>`);
  assert.ok(findings.some((f) => f.rule === "masked-review-value"));
});

test("review_screen: zebra striping, off-token shadows and gradients warn", () => {
  const findings = reviewScreenSource(`
    tr:nth-child(even) { background: var(--surface-sunken); }
    .card { box-shadow: 0 2px 4px var(--border-hairline); }
    .hero { background: linear-gradient(var(--accent), var(--surface-page)); }
  `);
  const rules = findings.map((f) => f.rule);
  assert.ok(rules.includes("zebra-striping"));
  assert.ok(rules.includes("shadow-outside-overlay"));
  assert.ok(rules.includes("gradient-surface"));
  assert.ok(findings.every((f) => f.severity === "warn"));
});

test("review_screen: state colours without any glyph warn; with a glyph they pass", () => {
  const bare = reviewScreenSource(`<span class="status" style="color: var(--state-pending-fg)">Pending</span>`);
  assert.ok(bare.some((f) => f.rule === "colour-only-state"));
  const withGlyph = reviewScreenSource(
    `<span class="status" style="color: var(--state-pending-fg)">Pending <span aria-hidden="true">○</span></span>`,
  );
  assert.equal(withGlyph.filter((f) => f.rule === "colour-only-state").length, 0);
});

test("review_screen: a token-clean screen produces no findings", () => {
  const findings = reviewScreenSource(`
    <section style="background: var(--surface-raised); border: var(--border-w-hairline) solid var(--border-hairline)">
      <span style="font-variant-numeric: tabular-nums">−1,240.00 <span>EUR</span></span>
    </section>
  `);
  assert.deepEqual(findings, []);
});

test("registry URL template points at this repo's committed registry", () => {
  assert.match(REGISTRY_URL_TEMPLATE, /^https:\/\/raw\.githubusercontent\.com\/Venly\/venly-settlement-sdk\/main\/ui\/r\/\{name\}\.json$/);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { VenlyProvider, useVenly } from "../src/provider.js";

function EnvironmentProbe() {
  const { environment } = useVenly();
  return createElement("span", null, `env:${environment}`);
}

test("mock provider renders with zero configuration", () => {
  const html = renderToString(
    createElement(VenlyProvider, { environment: "mock" }, createElement(EnvironmentProbe)),
  );
  assert.match(html, /env:mock/);
});

test("environment defaults to mock", () => {
  const html = renderToString(
    createElement(VenlyProvider, null, createElement(EnvironmentProbe)),
  );
  assert.match(html, /env:mock/);
});

test("useVenly outside the provider fails with a pointed message", () => {
  assert.throws(
    () => renderToString(createElement(EnvironmentProbe)),
    /outside <VenlyProvider>/,
  );
});

test("non-mock without credentials fails loudly", () => {
  assert.throws(
    () =>
      renderToString(
        createElement(
          VenlyProvider,
          { environment: "staging" },
          createElement(EnvironmentProbe),
        ),
      ),
    /no clientId was provided/,
  );
});

test("a clientSecret in a browser-like context is refused outside mock mode", () => {
  (globalThis as Record<string, unknown>).window = {};
  try {
    assert.throws(
      () =>
        renderToString(
          createElement(
            VenlyProvider,
            { environment: "staging", clientId: "id", clientSecret: "secret" },
            createElement(EnvironmentProbe),
          ),
        ),
      /Refusing to construct a credentialed client in the browser/,
    );
  } finally {
    delete (globalThis as Record<string, unknown>).window;
  }
});

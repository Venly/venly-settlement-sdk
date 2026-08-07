import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { VenlyProvider, useVenly } from "../src/provider.js";
import { proxyClientOptions } from "../src/proxy.js";

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

test("the guard also covers secrets smuggled through financeOptions/fundflowOptions", () => {
  (globalThis as Record<string, unknown>).window = {};
  try {
    // Regression: the options path used to short-circuit past the guard.
    assert.throws(
      () =>
        renderToString(
          createElement(
            VenlyProvider,
            {
              financeOptions: {
                environment: "production",
                clientId: "id",
                clientSecret: "REAL_SECRET",
              },
            },
            createElement(EnvironmentProbe),
          ),
        ),
      /Refusing to construct a credentialed client in the browser/,
    );
    assert.throws(
      () =>
        renderToString(
          createElement(
            VenlyProvider,
            {
              finance: undefined,
              fundflowOptions: {
                clientId: "id",
                clientSecret: "REAL_SECRET",
              },
            },
            createElement(EnvironmentProbe),
          ),
        ),
      /Refusing to construct a credentialed client in the browser/,
    );
  } finally {
    delete (globalThis as Record<string, unknown>).window;
  }
});

test("proxy options construct fine in a browser context (no real secret involved)", () => {
  (globalThis as Record<string, unknown>).window = {};
  try {
    const proxy = proxyClientOptions("https://app.example.com/api/venly");
    const html = renderToString(
      createElement(
        VenlyProvider,
        {
          environment: "production",
          financeOptions: proxy.finance,
          fundflowOptions: proxy.fundflow,
        },
        createElement(EnvironmentProbe),
      ),
    );
    assert.match(html, /env:production/);
  } finally {
    delete (globalThis as Record<string, unknown>).window;
  }
});

/** Shared test helpers: a scripted mock fetch and response builders. */

export function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

export function tokenResponse({ token = "tok-1", expiresIn = 300 } = {}) {
  return jsonResponse({ access_token: token, expires_in: expiresIn });
}

/**
 * Builds a mock fetch. `route(url, init)` is called for every non-token
 * request and must return a Response (or throw). All calls are recorded.
 */
export function mockFetch(route, { tokens } = {}) {
  const calls = [];
  let tokenCalls = 0;
  const fn = async (url, init = {}) => {
    const u = String(url);
    if (u.includes("/openid-connect/token")) {
      tokenCalls += 1;
      calls.push({ url: u, init, kind: "token" });
      if (tokens) return tokens(tokenCalls);
      return tokenResponse({ token: `tok-${tokenCalls}` });
    }
    calls.push({ url: u, init, kind: "api" });
    return route(u, init, calls);
  };
  fn.calls = calls;
  fn.apiCalls = () => calls.filter((c) => c.kind === "api");
  fn.tokenCallCount = () => calls.filter((c) => c.kind === "token").length;
  return fn;
}

export function clientOptions(fetchImpl, extra = {}) {
  return {
    clientId: "test-client",
    clientSecret: "test-secret",
    environment: "staging",
    fetch: fetchImpl,
    ...extra,
  };
}

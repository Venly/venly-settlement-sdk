import type {
  FundflowClientOptions,
  VenlyFinanceClientOptions,
} from "@venlyfinance/sdk";

/**
 * Client options for the browser-safe deployment shape: the browser talks to
 * YOUR backend, and your backend holds the credentials and forwards to Venly
 * with the real OAuth token. No secret ever enters the bundle.
 *
 * The SDK always runs an OAuth token flow before calling out, so this wraps
 * `fetch` to answer the token request locally with a synthetic token (your
 * proxy ignores the Authorization header and applies its own). Every API
 * call then goes to `proxyBaseUrl` unchanged.
 *
 * ```tsx
 * const proxy = proxyClientOptions("/api/venly");
 * <VenlyProvider environment="production"
 *   financeOptions={proxy.finance} fundflowOptions={proxy.fundflow} />
 * ```
 *
 * Server side, the matching route handler uses the SDK with real credentials
 * (see README "Going live" for a Next.js example) and MUST enforce its own
 * authentication: the proxy inherits your app's session, not Venly's.
 */
export interface ProxyClientOptions {
  finance: VenlyFinanceClientOptions;
  fundflow: FundflowClientOptions;
}

/**
 * The placeholder credential used by proxy options. It is not a secret –
 * the proxy backend ignores the Authorization header entirely – and the
 * provider's browser guard recognises it as safe. Never assign a real
 * secret this value.
 */
export const VENLY_PROXY_SECRET_SENTINEL = "venly-proxy";

const SYNTHETIC_TOKEN_PATH = "/__venly-proxy-token";

export function proxyClientOptions(
  proxyBaseUrl: string,
  options?: {
    fetch?: typeof fetch;
    /** Path under proxyBaseUrl that forwards to the Finance API. Default "/finance". */
    financePath?: string;
    /** Path under proxyBaseUrl that forwards to the Fundflow API. Default "/fundflow". */
    fundflowPath?: string;
  },
): ProxyClientOptions {
  const base = proxyBaseUrl.replace(/\/$/, "");
  const tokenUrl = `${base}${SYNTHETIC_TOKEN_PATH}`;
  const realFetch = options?.fetch ?? fetch;

  const proxyFetch: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === tokenUrl) {
      return Response.json({
        access_token: "venly-proxy",
        token_type: "Bearer",
        expires_in: 3600,
      });
    }
    return realFetch(input, init);
  };

  return {
    finance: {
      environment: "production",
      clientId: "venly-proxy",
      clientSecret: VENLY_PROXY_SECRET_SENTINEL,
      baseUrl: `${base}${options?.financePath ?? "/finance"}`,
      tokenUrl,
      fetch: proxyFetch,
    },
    fundflow: {
      environment: "production",
      clientId: "venly-proxy",
      clientSecret: VENLY_PROXY_SECRET_SENTINEL,
      baseUrl: `${base}${options?.fundflowPath ?? "/fundflow"}`,
      tokenUrl,
      fetch: proxyFetch,
    },
  };
}

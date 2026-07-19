import { VenlyAuthError } from "./errors.js";

export interface TokenManagerOptions {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  fetch: typeof fetch;
  /** Seconds subtracted from the token lifetime before it counts as expired. Default 30. */
  expirySkewSeconds?: number;
}

interface CachedToken {
  accessToken: string;
  /** Epoch millis after which we refresh. */
  refreshAfter: number;
}

/**
 * OAuth2 client-credentials token manager.
 *
 * Venly tokens expire after ~5 minutes; this caches the token, refreshes it
 * `expirySkewSeconds` before expiry, and single-flights concurrent refreshes
 * so N parallel requests trigger one token call, not N.
 */
export class TokenManager {
  private readonly opts: Required<TokenManagerOptions>;
  private cached: CachedToken | null = null;
  private inflight: Promise<string> | null = null;

  constructor(opts: TokenManagerOptions) {
    this.opts = { ...opts, expirySkewSeconds: opts.expirySkewSeconds ?? 30 };
  }

  async getToken(): Promise<string> {
    if (this.cached && Date.now() < this.cached.refreshAfter) {
      return this.cached.accessToken;
    }
    if (!this.inflight) {
      this.inflight = this.fetchToken().finally(() => {
        this.inflight = null;
      });
    }
    return this.inflight;
  }

  /** Drop the cached token, forcing a refresh on the next request (used after a 401). */
  invalidate(): void {
    this.cached = null;
  }

  private async fetchToken(): Promise<string> {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.opts.clientId,
      client_secret: this.opts.clientSecret,
    });
    const res = await this.opts.fetch(this.opts.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!res.ok) {
      let errBody: unknown;
      try {
        errBody = await res.json();
      } catch {
        errBody = await res.text().catch(() => undefined);
      }
      throw new VenlyAuthError(res.status, errBody);
    }
    const json = (await res.json()) as { access_token: string; expires_in?: number };
    const lifetimeSeconds = json.expires_in ?? 300;
    this.cached = {
      accessToken: json.access_token,
      refreshAfter:
        Date.now() + Math.max(lifetimeSeconds - this.opts.expirySkewSeconds, 0) * 1000,
    };
    return this.cached.accessToken;
  }
}

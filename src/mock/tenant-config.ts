/**
 * Static mock tenant configuration.
 *
 * Tenant operations live ONLY on the management plane
 * (`/v1/management/company-tenants/{companyId}/…`), which this SDK
 * deliberately never wraps - the management API is Venly-internal. What a
 * reference product still needs to explain is WHY its consumer surfaces
 * offer the rails, lanes and assets they do, so this module ships the
 * causal half as read-only seeded constants: no client resource, no mock
 * routes, no drivers, no CRUD.
 *
 * Shapes mirror the management contract's schemas field-for-field
 * (`VbaProviderEnablementDto`, `PayoutProviderEnablementDto`,
 * `CompanyVbaLanePreferenceDto`, `CompanyPayoutLanePreferenceDto`), so the
 * structure is on file for the day that plane exposes a public read - but
 * these interfaces are hand-held mirrors, not generated types, because the
 * management spec is not vendored here.
 *
 * Honesty rules this module obeys:
 *  - Every lane below corresponds to rails/assets the finance mock's seeded
 *    worlds actually serve (virtual bank accounts, payout routes, supported
 *    assets). A config row contradicting the consumer surface would teach a
 *    falsehood; the tenant-config test asserts the join in both directions.
 *  - Every provider value is simulated and asserts nothing about any live
 *    integration (same rule as the payout management twin).
 *  - A surface rendering this config badges it as sandbox configuration; it
 *    is seeded fact about the mock world, never live tenant state.
 */

/** Mirrors mgmt `VbaProviderEnablementDto` / `PayoutProviderEnablementDto`. */
export interface MockTenantProviderEnablement {
  providerType: "IRON" | "DAKOTA";
  createdAt: string;
}

/** Mirrors mgmt `CompanyVbaLanePreferenceDto` (id omitted: seeded constant). */
export interface MockTenantLanePreference {
  chain: "AVALANCHE" | "BASE" | "ETHEREUM" | "POLYGON" | "SOLANA";
  fiatCurrency: string;
  cryptoCurrency: string;
  providerType: "IRON" | "DAKOTA";
}

/** Mirrors mgmt `CompanyPayoutLanePreferenceDto` (id omitted: seeded constant). */
export interface MockTenantPayoutLanePreference {
  chain: "AVALANCHE" | "BASE" | "ETHEREUM" | "POLYGON" | "SOLANA";
  sourceAsset: string;
  fiatCurrency: string;
  rail: "US_ACH" | "SEPA";
  providerType: "IRON" | "DAKOTA";
}

export interface MockTenantConfig {
  /** Which virtual-bank-account providers the sandbox tenant has enabled. */
  vbaProviders: readonly MockTenantProviderEnablement[];
  /** Which payout providers the sandbox tenant has enabled. */
  payoutProviders: readonly MockTenantProviderEnablement[];
  /**
   * Pay-in lanes: which fiat currency converts into which asset on which
   * chain. These are why the consumer receive surface offers the accounts
   * it does.
   */
  vbaLanePreferences: readonly MockTenantLanePreference[];
  /**
   * Payout lanes: which source asset on which chain pays out to which fiat
   * currency over which rail. These are why the payout surfaces offer the
   * routes they do.
   */
  payoutLanePreferences: readonly MockTenantPayoutLanePreference[];
}

/**
 * The sandbox tenant's configuration, matched to the finance mock's seeded
 * worlds (both the base seeds and the demo cast):
 *  - VBA lanes cover exactly the (currency → targetCryptocurrency) pairs the
 *    seeded virtual bank accounts serve, on the chain the supported-assets
 *    seeds carry those assets.
 *  - Payout lanes cover exactly the (chain, depositAsset → fiatCurrency)
 *    pairs the seeded payout routes serve, over the rail the seeded payouts
 *    and beneficiary bank accounts use.
 */
export const mockTenantConfig: MockTenantConfig = {
  vbaProviders: [{ providerType: "IRON", createdAt: "2026-05-02T09:00:00Z" }],
  payoutProviders: [
    { providerType: "IRON", createdAt: "2026-05-02T09:00:00Z" },
    { providerType: "DAKOTA", createdAt: "2026-06-18T10:30:00Z" },
  ],
  vbaLanePreferences: [
    { chain: "BASE", fiatCurrency: "EUR", cryptoCurrency: "USDC", providerType: "IRON" },
    { chain: "BASE", fiatCurrency: "EUR", cryptoCurrency: "EURC", providerType: "IRON" },
  ],
  payoutLanePreferences: [
    { chain: "BASE", sourceAsset: "USDC", fiatCurrency: "EUR", rail: "SEPA", providerType: "DAKOTA" },
    { chain: "BASE", sourceAsset: "USDT", fiatCurrency: "EUR", rail: "SEPA", providerType: "DAKOTA" },
  ],
};

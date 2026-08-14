import {
  FundflowClient,
  VenlyFinanceClient,
  type MockCall,
} from "@venlyfinance/sdk";
import {
  resolveVenlyEnvironment,
  type VenlyEnvironment,
} from "../constants.js";
import type {
  Account,
  CryptoCurrency,
  CreateAccountInput,
  CreateCryptoTransferInput,
  CreateFiatTransferInput,
  CreatePartyInput,
  CreatePayInSessionRequest,
  CreateVirtualBankAccountInput,
  CurrentCreateFiatTransferInput,
  FiatCurrency,
  ListRampRequestsParams,
  OptimisticLockingBody,
  Party,
  PaymentSession,
  Payout,
  PayoutBankAccount,
  PayoutRoute,
  CreatePayoutInput,
  CreatePayoutRouteInput,
  RegisterPayoutBankAccountInput,
  PrepareOwnershipProofInput,
  PrepareOwnershipProofResult,
  CompleteOwnershipProofInput,
  RampRequestDto,
  RampRequestListItem,
  SupportedChains,
  Transfer,
  VenlyClient,
  VirtualBankAccount,
  VenlyFee,
  Wallet,
} from "../types.js";

/**
 * Normalize the legacy stage_transfer input to the current Finance
 * CreateFiatTransferInput wire shape. Exported so the write tool can show the
 * exact normalized request in its dry-run preview – the preview and the live
 * call must never diverge. The retired `cryptocurrency` field is rejected
 * rather than silently dropped: the current contract resolves the fiat amount
 * to the account's settlement asset itself.
 */
export function normalizeLegacyFiatTransfer(
  body: CreateFiatTransferInput,
): CurrentCreateFiatTransferInput {
  if (body.cryptocurrency !== undefined) {
    throw new Error(
      "cryptocurrency is not part of the current fiat-transfer contract and would be ignored; " +
        "omit it (the fiat amount is resolved to the account's settlement asset) or use " +
        "create_crypto_transfer for an asset-denominated transfer.",
    );
  }
  return {
    receiverAccountId: body.receiverAccountId,
    ...(body.receiverExternalId === undefined
      ? {}
      : { receiverExternalId: body.receiverExternalId }),
    currency: body.fiatCurrency,
    amount: Number(body.fiatAmount),
    description: body.description,
    merchantReference: body.merchantReference,
    idempotencyKey: body.idempotencyKey ?? crypto.randomUUID(),
  };
}

/**
 * Adapter from the generated Venly Finance SDK surface to the stable MCP
 * client contract. This keeps tools transport-agnostic while ensuring auth,
 * retries, idempotency and endpoint schemas come from the published SDK.
 */
export class SdkVenlyClient implements VenlyClient {
  constructor(
    private readonly finance: VenlyFinanceClient,
    private readonly fundflow: FundflowClient,
    readonly environment: VenlyEnvironment,
    private readonly hasCredentials = true,
  ) {}

  static mock(): SdkVenlyClient {
    return new SdkVenlyClient(
      new VenlyFinanceClient({ environment: "mock" }),
      new FundflowClient({ environment: "mock" }),
      "mock",
      true,
    );
  }

  static fromEnv(env: Record<string, string | undefined>): SdkVenlyClient {
    const environment = resolveVenlyEnvironment(env);
    if (environment === "mock") return SdkVenlyClient.mock();

    const clientId = env.VENLY_CLIENT_ID ?? "";
    const clientSecret = env.VENLY_CLIENT_SECRET ?? "";
    return new SdkVenlyClient(
      new VenlyFinanceClient({
        clientId,
        clientSecret,
        environment,
        baseUrl: env.VENLY_FINANCE_BASE_URL,
        tokenUrl: env.VENLY_TOKEN_URL,
      }),
      new FundflowClient({
        clientId,
        clientSecret,
        environment,
        baseUrl: env.VENLY_FUNDFLOW_BASE_URL,
        tokenUrl: env.VENLY_TOKEN_URL,
      }),
      environment,
      Boolean(env.VENLY_CLIENT_ID && env.VENLY_CLIENT_SECRET),
    );
  }

  /** Exposed for deterministic zero-network adapter and journey tests. */
  get financeMockCalls(): readonly MockCall[] {
    return this.finance.mock?.calls ?? [];
  }

  /** Exposed for deterministic zero-network adapter and journey tests. */
  get fundflowMockCalls(): readonly MockCall[] {
    return this.fundflow.mock?.calls ?? [];
  }

  private assertReady(): void {
    if (this.environment !== "mock" && !this.hasCredentials) {
      throw new Error(
        "Missing Venly credentials. Set VENLY_CLIENT_ID and VENLY_CLIENT_SECRET.",
      );
    }
  }

  async listRampRequests(params?: ListRampRequestsParams): Promise<RampRequestListItem[]> {
    this.assertReady();
    const page = await this.fundflow.rampRequests.list(params);
    return page.items;
  }

  async getRampRequest(id: string): Promise<RampRequestDto> {
    this.assertReady();
    return this.fundflow.rampRequests.get(id);
  }

  async getAccount(accountId: string): Promise<Account> {
    this.assertReady();
    return this.finance.accounts.get(accountId);
  }

  async listAccounts(params?: { page?: number; size?: number }): Promise<Account[]> {
    this.assertReady();
    const page = await this.finance.accounts.list(params);
    return page.items;
  }

  async listWallets(
    accountId: string,
    params?: { page?: number; size?: number },
  ): Promise<Wallet[]> {
    this.assertReady();
    const page = await this.finance.wallets.list(accountId, params);
    return page.items;
  }

  async listVirtualBankAccounts(accountId: string): Promise<VirtualBankAccount[]> {
    this.assertReady();
    const page = await this.finance.virtualBankAccounts.list(accountId);
    return page.items;
  }

  async getVirtualBankAccount(
    accountId: string,
    virtualBankAccountId: string,
  ): Promise<VirtualBankAccount> {
    this.assertReady();
    return this.finance.virtualBankAccounts.get(accountId, virtualBankAccountId);
  }

  async listTransfers(
    accountId: string,
    params?: { page?: number; size?: number },
  ): Promise<Transfer[]> {
    this.assertReady();
    const page = await this.finance.transfers.list(accountId, params);
    return page.items;
  }

  async getTransfer(accountId: string, transferId: string): Promise<Transfer> {
    this.assertReady();
    return this.finance.transfers.get(accountId, transferId);
  }

  async listParties(params?: { page?: number; size?: number }): Promise<Party[]> {
    this.assertReady();
    const page = await this.finance.parties.list(params);
    return page.items;
  }

  async getParty(partyId: string): Promise<Party> {
    this.assertReady();
    return this.finance.parties.get(partyId);
  }

  async getSupportedChains(): Promise<SupportedChains[]> {
    this.assertReady();
    return this.fundflow.referenceData.chains();
  }

  async getFiatCurrencies(): Promise<FiatCurrency[]> {
    this.assertReady();
    return this.fundflow.referenceData.fiatCurrencies();
  }

  async getCryptocurrencies(): Promise<CryptoCurrency[]> {
    this.assertReady();
    return this.fundflow.referenceData.cryptoCurrencies();
  }

  async getCompanyFees(): Promise<VenlyFee[]> {
    this.assertReady();
    return this.fundflow.fees.listCompanyFees();
  }

  async createFiatTransfer(
    senderAccountId: string,
    body: CreateFiatTransferInput,
  ): Promise<Transfer> {
    this.assertReady();
    return this.finance.transfers.createFiat(
      senderAccountId,
      normalizeLegacyFiatTransfer(body),
    );
  }

  async createParty(body: CreatePartyInput): Promise<Party> {
    this.assertReady();
    return this.finance.parties.create(body);
  }

  async createAccount(body: CreateAccountInput): Promise<Account> {
    this.assertReady();
    return this.finance.accounts.create(body);
  }

  async createVirtualBankAccount(
    accountId: string,
    body: CreateVirtualBankAccountInput,
  ): Promise<VirtualBankAccount> {
    this.assertReady();
    return this.finance.virtualBankAccounts.create(accountId, body);
  }

  async createCurrentFiatTransfer(
    senderAccountId: string,
    body: CurrentCreateFiatTransferInput,
  ): Promise<Transfer> {
    this.assertReady();
    return this.finance.transfers.createFiat(senderAccountId, body);
  }

  async createCryptoTransfer(
    senderAccountId: string,
    body: CreateCryptoTransferInput,
  ): Promise<Transfer> {
    this.assertReady();
    return this.finance.transfers.createCrypto(senderAccountId, body);
  }

  async approveRampRequest(
    id: string,
    body: OptimisticLockingBody,
  ): Promise<RampRequestDto> {
    this.assertReady();
    return this.fundflow.rampRequests.approve(id, body);
  }

  async rejectRampRequest(
    id: string,
    body: OptimisticLockingBody,
  ): Promise<RampRequestDto> {
    this.assertReady();
    return this.fundflow.rampRequests.reject(id, body);
  }

  async createPayInSession(
    accountId: string,
    body: CreatePayInSessionRequest,
  ): Promise<PaymentSession> {
    this.assertReady();
    return this.finance.paymentSessions.create(accountId, body);
  }

  // ----- Payout surface (contract 1.3.0) -----

  async listPayouts(
    accountId: string,
    params?: { page?: number; size?: number; status?: string },
  ): Promise<Payout[]> {
    this.assertReady();
    const page = await this.finance.payouts.list(
      accountId,
      params as Parameters<typeof this.finance.payouts.list>[1],
    );
    return page.items;
  }

  async getPayout(accountId: string, payoutId: string): Promise<Payout> {
    this.assertReady();
    return this.finance.payouts.get(accountId, payoutId);
  }

  async requestPayout(accountId: string, body: CreatePayoutInput): Promise<Payout> {
    this.assertReady();
    return this.finance.payouts.request(accountId, body);
  }

  async listPayoutRoutes(accountId: string): Promise<PayoutRoute[]> {
    this.assertReady();
    return this.finance.payoutRoutes.list(accountId);
  }

  async createPayoutRoute(
    accountId: string,
    body: CreatePayoutRouteInput,
  ): Promise<PayoutRoute> {
    this.assertReady();
    return this.finance.payoutRoutes.create(accountId, body);
  }

  async preparePayoutOwnershipProof(
    accountId: string,
    routeId: string,
    body: PrepareOwnershipProofInput,
  ): Promise<PrepareOwnershipProofResult> {
    this.assertReady();
    return this.finance.payoutRoutes.prepareOwnershipProof(accountId, routeId, body);
  }

  async completePayoutOwnershipProof(
    accountId: string,
    routeId: string,
    body: CompleteOwnershipProofInput,
  ): Promise<PayoutRoute> {
    this.assertReady();
    return this.finance.payoutRoutes.completeOwnershipProof(accountId, routeId, body);
  }

  async listPayoutBankAccounts(partyId: string): Promise<PayoutBankAccount[]> {
    this.assertReady();
    const page = await this.finance.payoutBankAccounts.list(partyId);
    return page.items;
  }

  async registerPayoutBankAccount(
    partyId: string,
    body: RegisterPayoutBankAccountInput,
  ): Promise<PayoutBankAccount> {
    this.assertReady();
    return this.finance.payoutBankAccounts.register(partyId, body);
  }
}

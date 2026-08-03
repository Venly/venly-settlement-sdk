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
  CreateAccountInput,
  CreateCryptoTransferInput,
  CreateFiatTransferInput,
  CreatePartyInput,
  CreatePayInSessionRequest,
  CreateVirtualBankAccountInput,
  CurrentCreateFiatTransferInput,
  ListRampRequestsParams,
  OptimisticLockingBody,
  Party,
  PaymentSession,
  RampRequestDto,
  RampRequestListItem,
  Transfer,
  VenlyClient,
  VirtualBankAccount,
  Wallet,
} from "../types.js";

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
    return page.items as RampRequestListItem[];
  }

  async getRampRequest(id: string): Promise<RampRequestDto> {
    this.assertReady();
    return (await this.fundflow.rampRequests.get(id)) as RampRequestDto;
  }

  async getAccount(accountId: string): Promise<Account> {
    this.assertReady();
    return (await this.finance.accounts.get(accountId)) as Account;
  }

  async listAccounts(params?: { page?: number; size?: number }): Promise<Account[]> {
    this.assertReady();
    const page = await this.finance.accounts.list(params);
    return page.items as Account[];
  }

  async listWallets(
    accountId: string,
    params?: { page?: number; size?: number },
  ): Promise<Wallet[]> {
    this.assertReady();
    const page = await this.finance.wallets.list(accountId, params);
    return page.items as Wallet[];
  }

  async listVirtualBankAccounts(accountId: string): Promise<VirtualBankAccount[]> {
    this.assertReady();
    const page = await this.finance.virtualBankAccounts.list(accountId);
    return page.items as VirtualBankAccount[];
  }

  async getVirtualBankAccount(
    accountId: string,
    virtualBankAccountId: string,
  ): Promise<VirtualBankAccount> {
    this.assertReady();
    return (await this.finance.virtualBankAccounts.get(
      accountId,
      virtualBankAccountId,
    )) as VirtualBankAccount;
  }

  async listTransfers(
    accountId: string,
    params?: { page?: number; size?: number },
  ): Promise<Transfer[]> {
    this.assertReady();
    const page = await this.finance.transfers.list(accountId, params);
    return page.items as Transfer[];
  }

  async getTransfer(accountId: string, transferId: string): Promise<Transfer> {
    this.assertReady();
    return (await this.finance.transfers.get(accountId, transferId)) as Transfer;
  }

  async listParties(params?: { page?: number; size?: number }): Promise<Party[]> {
    this.assertReady();
    const page = await this.finance.parties.list(params);
    return page.items as Party[];
  }

  async getParty(partyId: string): Promise<Party> {
    this.assertReady();
    return (await this.finance.parties.get(partyId)) as Party;
  }

  async getSupportedChains(): Promise<unknown[]> {
    this.assertReady();
    return this.fundflow.referenceData.chains();
  }

  async getFiatCurrencies(): Promise<unknown[]> {
    this.assertReady();
    return this.fundflow.referenceData.fiatCurrencies();
  }

  async getCryptocurrencies(): Promise<unknown[]> {
    this.assertReady();
    return this.fundflow.referenceData.cryptoCurrencies();
  }

  async getCompanyFees(): Promise<unknown> {
    this.assertReady();
    return this.fundflow.fees.listCompanyFees();
  }

  async createFiatTransfer(
    senderAccountId: string,
    body: CreateFiatTransferInput,
  ): Promise<Transfer> {
    this.assertReady();
    const normalized = {
      receiverAccountId: body.receiverAccountId,
      ...(body.receiverExternalId === undefined
        ? {}
        : { receiverExternalId: body.receiverExternalId }),
      currency: body.fiatCurrency,
      amount: Number(body.fiatAmount),
      description: body.description,
      merchantReference: body.merchantReference,
      idempotencyKey: crypto.randomUUID(),
    };
    return (await this.finance.transfers.createFiat(senderAccountId, normalized)) as Transfer;
  }

  async createParty(body: CreatePartyInput): Promise<Party> {
    this.assertReady();
    return (await this.finance.parties.create(body)) as Party;
  }

  async createAccount(body: CreateAccountInput): Promise<Account> {
    this.assertReady();
    return (await this.finance.accounts.create(body)) as Account;
  }

  async createVirtualBankAccount(
    accountId: string,
    body: CreateVirtualBankAccountInput,
  ): Promise<VirtualBankAccount> {
    this.assertReady();
    return (await this.finance.virtualBankAccounts.create(
      accountId,
      body,
    )) as VirtualBankAccount;
  }

  async createCurrentFiatTransfer(
    senderAccountId: string,
    body: CurrentCreateFiatTransferInput,
  ): Promise<Transfer> {
    this.assertReady();
    return (await this.finance.transfers.createFiat(senderAccountId, body)) as Transfer;
  }

  async createCryptoTransfer(
    senderAccountId: string,
    body: CreateCryptoTransferInput,
  ): Promise<Transfer> {
    this.assertReady();
    return (await this.finance.transfers.createCrypto(senderAccountId, body)) as Transfer;
  }

  async approveRampRequest(
    id: string,
    body: OptimisticLockingBody,
  ): Promise<RampRequestDto> {
    this.assertReady();
    return (await this.fundflow.rampRequests.approve(id, body)) as RampRequestDto;
  }

  async rejectRampRequest(
    id: string,
    body: OptimisticLockingBody,
  ): Promise<RampRequestDto> {
    this.assertReady();
    return (await this.fundflow.rampRequests.reject(id, body)) as RampRequestDto;
  }

  async createPayInSession(
    accountId: string,
    body: CreatePayInSessionRequest,
  ): Promise<PaymentSession> {
    this.assertReady();
    return (await this.finance.paymentSessions.create(accountId, body)) as PaymentSession;
  }
}

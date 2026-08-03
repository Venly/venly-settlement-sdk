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
  CreateFiatTransferInput,
  CreatePayInSessionRequest,
  ListRampRequestsParams,
  OptimisticLockingBody,
  Party,
  PaymentSession,
  RampRequestDto,
  RampRequestListItem,
  Transfer,
  VenlyClient,
  VirtualBankAccount,
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
  ) {}

  static mock(): SdkVenlyClient {
    return new SdkVenlyClient(
      new VenlyFinanceClient({ environment: "mock" }),
      new FundflowClient({ environment: "mock" }),
      "mock",
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
    );
  }

  /** Exposed for deterministic zero-network adapter and journey tests. */
  get financeMockCalls(): readonly MockCall[] {
    return this.finance.mock?.calls ?? [];
  }

  async listRampRequests(params?: ListRampRequestsParams): Promise<RampRequestListItem[]> {
    const page = await this.fundflow.rampRequests.list(params);
    return page.items as RampRequestListItem[];
  }

  async getRampRequest(id: string): Promise<RampRequestDto> {
    return (await this.fundflow.rampRequests.get(id)) as RampRequestDto;
  }

  async getAccount(accountId: string): Promise<Account> {
    return (await this.finance.accounts.get(accountId)) as Account;
  }

  async listVirtualBankAccounts(accountId: string): Promise<VirtualBankAccount[]> {
    const page = await this.finance.virtualBankAccounts.list(accountId);
    return page.items as VirtualBankAccount[];
  }

  async getTransfer(accountId: string, transferId: string): Promise<Transfer> {
    return (await this.finance.transfers.get(accountId, transferId)) as Transfer;
  }

  async listParties(params?: { page?: number; size?: number }): Promise<Party[]> {
    const page = await this.finance.parties.list(params);
    return page.items as Party[];
  }

  async getSupportedChains(): Promise<unknown[]> {
    return this.fundflow.referenceData.chains();
  }

  async getFiatCurrencies(): Promise<unknown[]> {
    return this.fundflow.referenceData.fiatCurrencies();
  }

  async getCryptocurrencies(): Promise<unknown[]> {
    return this.fundflow.referenceData.cryptoCurrencies();
  }

  async getCompanyFees(): Promise<unknown> {
    return this.fundflow.fees.listCompanyFees();
  }

  async createFiatTransfer(
    senderAccountId: string,
    body: CreateFiatTransferInput,
  ): Promise<Transfer> {
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

  async approveRampRequest(
    id: string,
    body: OptimisticLockingBody,
  ): Promise<RampRequestDto> {
    return (await this.fundflow.rampRequests.approve(id, body)) as RampRequestDto;
  }

  async rejectRampRequest(
    id: string,
    body: OptimisticLockingBody,
  ): Promise<RampRequestDto> {
    return (await this.fundflow.rampRequests.reject(id, body)) as RampRequestDto;
  }

  async createPayInSession(
    accountId: string,
    body: CreatePayInSessionRequest,
  ): Promise<PaymentSession> {
    return (await this.finance.paymentSessions.create(accountId, body)) as PaymentSession;
  }
}

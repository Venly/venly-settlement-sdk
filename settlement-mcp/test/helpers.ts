/**
 * Test helpers: an in-memory MCP client/server pair and a mock VenlyClient with
 * call tracking. No network. Not a test file itself (node --test only runs
 * *.test.ts), just shared fixtures.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";
import type { EnvLike } from "../src/safety.js";
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
  RampRequestDto,
  RampRequestListItem,
  SupportedChains,
  Transfer,
  VenlyClient,
  VirtualBankAccount,
  VenlyFee,
  Wallet,
  Payout,
  CreatePayoutInput,
  PayoutRoute,
  CreatePayoutRouteInput,
  PayoutBankAccount,
  RegisterPayoutBankAccountInput,
  PrepareOwnershipProofInput,
  PrepareOwnershipProofResult,
  CompleteOwnershipProofInput,
} from "../src/types.js";

/** Records which methods were called, so tests can assert no live call fired. */
export class MockVenlyClient implements VenlyClient {
  public calls: string[] = [];

  private track(name: string) {
    this.calls.push(name);
  }

  called(name: string): boolean {
    return this.calls.includes(name);
  }

  // ----- READ -----
  async listRampRequests(_params?: ListRampRequestsParams): Promise<RampRequestListItem[]> {
    this.track("listRampRequests");
    return [
      {
        id: "rr-1",
        paymentReference: "PAY-2024-001234",
        rampType: "ON_RAMP",
        status: "AWAITING_APPROVAL",
        fiatAmount: 1000,
        fiatCurrency: "EUR",
        cryptoAmount: 0.5,
        cryptoCurrency: "USDC",
        createdAt: "2026-07-20T09:00:00Z",
        createdBy: "manager@acme.eu",
      },
    ];
  }

  async getRampRequest(id: string): Promise<RampRequestDto> {
    this.track("getRampRequest");
    return {
      id,
      companyName: "Acme EU",
      rampType: "ON_RAMP",
      status: "AWAITING_APPROVAL",
      fiatAmount: 1000,
      fiatNetAmount: 990,
      cryptoAmount: 0.5,
      paymentReference: "PAY-2024-001234",
      version: 3,
    };
  }

  async getAccount(accountId: string): Promise<Account> {
    this.track("getAccount");
    return { id: accountId, status: "ACTIVE", externalId: "acct-ref-1" };
  }

  async listAccounts(_params?: { page?: number; size?: number }): Promise<Account[]> {
    this.track("listAccounts");
    return [{ id: "acct-1", status: "ACTIVE", externalId: "acct-ref-1" }];
  }

  async listWallets(
    accountId: string,
    _params?: { page?: number; size?: number },
  ): Promise<Wallet[]> {
    this.track("listWallets");
    // Contract 1.3.0: per-asset balance rows, amounts as numbers.
    return [
      {
        asset: "USDC",
        contractAddress: "0xabc",
        amount: { total: 1000, available: 900, reserved: 100 },
      },
    ];
  }

  async listVirtualBankAccounts(accountId: string): Promise<VirtualBankAccount[]> {
    this.track("listVirtualBankAccounts");
    return [
      {
        id: "vban-1",
        accountId,
        bankAccountType: "EUR_SEPA",
        name: "EUR Deposit",
        status: "ACTIVE",
        currency: "EUR",
        iban: "DE89370400440532013000",
        bic: "DEUTDEDB",
        referenceCode: "REF-ABC-123",
      },
      {
        id: "vban-2",
        accountId,
        bankAccountType: "EUR_SEPA",
        name: "EUR Deposit 2",
        status: "ACTIVE",
        currency: "EUR",
        iban: "DE89370400440532099999",
        referenceCode: "REF-XYZ-999",
      },
    ];
  }

  async getVirtualBankAccount(
    accountId: string,
    virtualBankAccountId: string,
  ): Promise<VirtualBankAccount> {
    this.track("getVirtualBankAccount");
    return {
      id: virtualBankAccountId,
      accountId,
      bankAccountType: "EUR_SEPA",
      status: "ACTIVE",
      currency: "EUR",
      iban: "DE89370400440532013000",
      bic: "DEUTDEDB",
      referenceCode: "REF-ABC-123",
    };
  }

  async listTransfers(
    _accountId: string,
    _params?: { page?: number; size?: number },
  ): Promise<Transfer[]> {
    this.track("listTransfers");
    return [
      {
        id: "tr-1",
        status: "COMPLETED",
        chain: "BASE",
        asset: "USDC",
        amount: 1000,
        fiatOrigin: { currency: "EUR", amount: 1000 },
      },
    ];
  }

  async getTransfer(_accountId: string, transferId: string): Promise<Transfer> {
    this.track("getTransfer");
    return {
      id: transferId,
      status: "COMPLETED",
      chain: "BASE",
      asset: "USDC",
      amount: 1000,
      fiatOrigin: { currency: "EUR", amount: 1000 },
    };
  }

  async listParties(_params?: { page?: number; size?: number }): Promise<Party[]> {
    this.track("listParties");
    return [{ id: "party-1", partyType: "ORGANISATION", status: "ACTIVE" }];
  }

  async getParty(partyId: string): Promise<Party> {
    this.track("getParty");
    return { id: partyId, partyType: "ORGANISATION", status: "ACTIVE" };
  }

  async getSupportedChains(): Promise<SupportedChains[]> {
    this.track("getSupportedChains");
    return [{ supportedChains: ["BASE"] }];
  }

  async getFiatCurrencies(): Promise<FiatCurrency[]> {
    this.track("getFiatCurrencies");
    return [{ id: "fiat-eur", currency: "EUR", label: "Euro", enabled: true }];
  }

  async getCryptocurrencies(): Promise<CryptoCurrency[]> {
    this.track("getCryptocurrencies");
    return [
      { id: "crypto-usdc-base", currency: "USDC", chain: "BASE", enabled: true },
    ];
  }

  async getCompanyFees(): Promise<VenlyFee[]> {
    this.track("getCompanyFees");
    return [{ id: "fee-1", type: "ON_RAMP", percentage: 1 }];
  }

  // ----- WRITE (must NOT be called unless gate armed) -----
  async createParty(body: CreatePartyInput): Promise<Party> {
    this.track("createParty");
    return { id: "party-created-1", status: "ACTIVE", ...body };
  }

  async createAccount(body: CreateAccountInput): Promise<Account> {
    this.track("createAccount");
    return {
      id: "account-created-1",
      externalId: body.externalId,
      name: body.name,
      status: "ACTIVE",
      kycStatus: "VERIFICATION_PENDING",
    };
  }

  async createVirtualBankAccount(
    accountId: string,
    body: CreateVirtualBankAccountInput,
  ): Promise<VirtualBankAccount> {
    this.track("createVirtualBankAccount");
    return {
      id: "vban-created-1",
      accountId,
      bankAccountType: "EUR_SEPA",
      status: "ACTIVE",
      currency: "EUR",
      targetCryptocurrency: "USDC",
      referenceCode: "REF-CREATED-1",
    };
  }

  async createFiatTransfer(
    _senderAccountId: string,
    _body: CreateFiatTransferInput,
  ): Promise<Transfer> {
    this.track("createFiatTransfer");
    return { id: "transfer-live-1", status: "PENDING" };
  }

  async createCurrentFiatTransfer(
    _senderAccountId: string,
    _body: CurrentCreateFiatTransferInput,
  ): Promise<Transfer> {
    this.track("createFiatTransfer");
    return { id: "transfer-fiat-1", status: "PENDING" };
  }

  async createCryptoTransfer(
    _senderAccountId: string,
    _body: CreateCryptoTransferInput,
  ): Promise<Transfer> {
    this.track("createCryptoTransfer");
    return { id: "transfer-crypto-1", status: "PENDING" };
  }

  async approveRampRequest(id: string, _body: OptimisticLockingBody): Promise<RampRequestDto> {
    this.track("approveRampRequest");
    return { id, status: "AWAITING_FUNDS", version: 4 };
  }

  async rejectRampRequest(id: string, _body: OptimisticLockingBody): Promise<RampRequestDto> {
    this.track("rejectRampRequest");
    return { id, status: "REJECTED", version: 4 };
  }

  async createPayInSession(
    accountId: string,
    _body: CreatePayInSessionRequest,
  ): Promise<PaymentSession> {
    this.track("createPayInSession");
    return {
      id: "session-live-1",
      accountId,
      paymentUrl: "https://pay.example/x",
      status: "CREATED",
    };
  }

  // ----- Payout surface (contract 1.3.0) -----

  async listPayouts(
    accountId: string,
    _params?: { page?: number; size?: number; status?: string },
  ): Promise<Payout[]> {
    this.track("listPayouts");
    return [
      {
        id: "payout-1",
        accountId,
        rail: "SEPA",
        cryptoAmount: 100,
        fundingMode: "PULL",
        status: "COMPLETED",
        settledFiatAmount: 100,
      },
    ];
  }

  async getPayout(accountId: string, payoutId: string): Promise<Payout> {
    this.track("getPayout");
    return { id: payoutId, accountId, status: "REQUESTED", cryptoAmount: 100 };
  }

  async requestPayout(accountId: string, body: CreatePayoutInput): Promise<Payout> {
    this.track("requestPayout");
    return {
      id: "payout-live-1",
      accountId,
      cryptoAmount: body.cryptoAmount,
      fundingMode: "PULL",
      status: "REQUESTED",
    };
  }

  async listPayoutRoutes(accountId: string): Promise<PayoutRoute[]> {
    this.track("listPayoutRoutes");
    void accountId;
    return [{ id: "route-1", status: "ACTIVE", fiatCurrency: "EUR" }];
  }

  async createPayoutRoute(
    _accountId: string,
    body: CreatePayoutRouteInput,
  ): Promise<PayoutRoute> {
    this.track("createPayoutRoute");
    return {
      id: "route-live-1",
      status: "AWAITING_OWNERSHIP_PROOF",
      depositAsset: body.depositAsset,
    };
  }

  async preparePayoutOwnershipProof(
    _accountId: string,
    routeId: string,
    body: PrepareOwnershipProofInput,
  ): Promise<PrepareOwnershipProofResult> {
    this.track("preparePayoutOwnershipProof");
    return {
      walletAddress: body.walletAddress,
      blockchain: body.blockchain,
      message: `proof:${routeId}`,
      signedOnUtc: "2026-08-14T00:00:00Z",
    };
  }

  async completePayoutOwnershipProof(
    _accountId: string,
    routeId: string,
    _body: CompleteOwnershipProofInput,
  ): Promise<PayoutRoute> {
    this.track("completePayoutOwnershipProof");
    return { id: routeId, status: "ACTIVE" };
  }

  async listPayoutBankAccounts(partyId: string): Promise<PayoutBankAccount[]> {
    this.track("listPayoutBankAccounts");
    return [{ id: "pba-1", partyId, rail: "SEPA", status: "ACTIVE" }];
  }

  async registerPayoutBankAccount(
    partyId: string,
    body: RegisterPayoutBankAccountInput,
  ): Promise<PayoutBankAccount> {
    this.track("registerPayoutBankAccount");
    return {
      id: "pba-live-1",
      partyId,
      rail: body.rail as PayoutBankAccount["rail"],
      status: "PENDING",
    };
  }
}

export interface Harness {
  client: Client;
  mock: MockVenlyClient;
  close: () => Promise<void>;
}

/** Build an in-memory MCP client wired to the server over a linked transport. */
export async function makeHarness(env: EnvLike = {}): Promise<Harness> {
  const mock = new MockVenlyClient();
  const server = createServer({ client: mock, env });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return {
    client,
    mock,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

/** Call a tool and parse the JSON text payload it returns. */
export async function callToolJson(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<{ raw: any; data: any; isError: boolean }> {
  const res: any = await client.callTool({ name, arguments: args });
  const text = res.content?.[0]?.text ?? "";
  let data: any = undefined;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { raw: res, data, isError: Boolean(res.isError) };
}

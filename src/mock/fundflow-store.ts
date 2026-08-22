import type { components } from "../generated/fundflow.js";
import { mockError, type HandlerContext } from "./transport.js";

type schemas = components["schemas"];
type RampRequest = schemas["RampRequestDto"];
type RampListItem = schemas["RampRequestListItem"];
type RampEvent = schemas["RampRequestEventDto"];
type BankAccount = schemas["CompanyBankAccountDto"] & {
  iban?: string;
  bic?: string;
  intermediaryBic?: string;
  accountNumber?: string;
  sortCode?: string;
  routingNumber?: string;
  currency?: string;
};
type CompanyWallet = schemas["CompanyWalletDto"];
type DepositWallet = schemas["DepositWalletDto"];
type FiatCurrency = schemas["FiatCurrencyDto"];
type CryptoCurrency = schemas["CryptoCurrencyDto"];

/**
 * The identity the mock stamps on ramp events and list-item `createdBy`.
 * Host apps set it from their own session (`client.mock.setActor(...)`) so
 * capability reads that join on the creator - the four-eyes own-request
 * rule - see the signed-in user rather than an anonymous placeholder.
 */
export interface FundflowMockActor {
  username?: string;
  email?: string;
  role?: RampEvent["role"];
}

export const DEFAULT_FUNDFLOW_ACTOR: Required<FundflowMockActor> = {
  username: "mock-user",
  email: "mock-user@example.com",
  role: "COMPANY_ADMIN",
};

export interface FundflowSeeds {
  rampRequests: RampRequest[];
  /** `createdBy` lives on LIST items only (contract fact); keyed by ramp id. */
  createdBy: Record<string, string>;
  bankAccounts: BankAccount[];
  companyWallets: CompanyWallet[];
  depositWallets: DepositWallet[];
  fiatCurrencies: FiatCurrency[];
  cryptoCurrencies: CryptoCurrency[];
  bankAccountConfig: schemas["BankAccountConfigDto"];
  feePercentage: number;
  /**
   * Fiat per 1 crypto unit, keyed `"CRYPTO/FIAT"` (e.g. `"USDC/EUR"`).
   * Deliberately NEVER 1.0: a parity rate makes the crypto and fiat sides
   * of a ramp numerically identical and hides the unit distinction the
   * product exists to keep visible.
   */
  exchangeRates: Record<string, number>;
}

/** Fiat sides round to cents; crypto sides to 6 decimals (USDC-style). */
const round2 = (n: number): number => Math.round(n * 100) / 100;
const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;

function badRequest(ctx: HandlerContext, message: string): never {
  mockError({ status: 400, code: "invalid-request", message }, ctx.method, ctx.path);
}

function notFound(ctx: HandlerContext, message: string): never {
  mockError({ status: 404, code: "NOT_FOUND", message }, ctx.method, ctx.path);
}

function versionConflict(ctx: HandlerContext): never {
  mockError(
    {
      status: 409,
      code: "OPTIMISTIC_LOCK_EXCEPTION",
      message: "The resource has been modified. Please fetch the latest version and retry.",
    },
    ctx.method,
    ctx.path,
  );
}

function now(): string {
  return new Date().toISOString();
}

/**
 * Stateful Fundflow mock: the ramp lifecycle behaves like the documented
 * state machine instead of echoing fixtures.
 *
 * - Four-eyes actions are legal only from the states the API documents
 *   (approve/reject/cancel from AWAITING_APPROVAL; initiate/tx-hash from
 *   AWAITING_FUNDS on an OFF_RAMP). Illegal transitions are 400s.
 * - Every mutating call carries `{version}`; a stale version is a 409
 *   OPTIMISTIC_LOCK_EXCEPTION, exactly like the live API's locking.
 * - Events accrete on the request, so timelines render real history.
 * - What the mock deliberately does NOT model: identity ENFORCEMENT
 *   (creator ≠ approver is enforced server-side against the authenticated
 *   principal, which client-credential mocks don't have) and Venly-admin
 *   channels (BLOCKED/DENIED are reachable via `advanceRamp` only). The
 *   stamped identity, however, IS settable: `setActor()` lets a host app
 *   stamp its own signed-in user on events and `createdBy`, so an
 *   own-request read (the four-eyes creator rule) can join records to the
 *   session. Without it, every live-created request carried the same
 *   anonymous actor and a creator could approve their own request one
 *   click later while the surface copy said that was impossible.
 */
export class FundflowMockStore {
  rampRequests: RampRequest[] = [];
  createdBy = new Map<string, string>();
  /**
   * The acting identity stamped on new events and `createdBy`. Session
   * identity, not world state: `reset()` restores the seeds but leaves the
   * actor alone - reseeding the world does not sign anyone out.
   */
  private actor: Required<FundflowMockActor> = { ...DEFAULT_FUNDFLOW_ACTOR };
  bankAccounts: BankAccount[] = [];
  companyWallets: CompanyWallet[] = [];
  depositWallets: DepositWallet[] = [];
  fiatCurrencies: FiatCurrency[] = [];
  cryptoCurrencies: CryptoCurrency[] = [];
  bankAccountConfig: schemas["BankAccountConfigDto"] = {};
  private feePercentage = 1.0;
  private exchangeRates: Record<string, number> = {};
  private readonly seeds: FundflowSeeds;

  constructor(seeds: FundflowSeeds) {
    this.seeds = seeds;
    this.reset();
  }

  reset(): void {
    const s = structuredClone(this.seeds);
    this.rampRequests = s.rampRequests;
    this.createdBy = new Map(Object.entries(s.createdBy));
    this.bankAccounts = s.bankAccounts;
    this.companyWallets = s.companyWallets;
    this.depositWallets = s.depositWallets;
    this.fiatCurrencies = s.fiatCurrencies;
    this.cryptoCurrencies = s.cryptoCurrencies;
    this.bankAccountConfig = s.bankAccountConfig;
    this.feePercentage = s.feePercentage;
    this.exchangeRates = s.exchangeRates;
  }

  /** Set the acting identity; omitted fields keep their defaults. */
  setActor(actor: FundflowMockActor): void {
    this.actor = { ...DEFAULT_FUNDFLOW_ACTOR, ...actor };
  }

  /** Fiat per 1 crypto unit for the pair; unknown pairs are a 400, not 1.0. */
  private rateFor(ctx: HandlerContext, crypto: CryptoCurrency, fiat: FiatCurrency): number {
    const key = `${crypto.currency}/${fiat.currency}`;
    const rate = this.exchangeRates[key];
    if (rate === undefined) {
      badRequest(ctx, `No exchange rate is configured for ${key} in the mock.`);
    }
    return rate;
  }

  // ── Ramp requests ────────────────────────────────────────────────────

  private findRamp(ctx: HandlerContext): RampRequest {
    const ramp = this.rampRequests.find((r) => r.id === ctx.params.id);
    if (!ramp) notFound(ctx, `No ramp request with id ${ctx.params.id}.`);
    return ramp;
  }

  private requireVersion(ctx: HandlerContext, ramp: RampRequest): void {
    const body = ctx.body as { version?: number } | undefined;
    if (body?.version === undefined) badRequest(ctx, '"version" is required.');
    if (body.version !== ramp.version) versionConflict(ctx);
  }

  private pushEvent(ramp: RampRequest, eventType: RampEvent["eventType"], metadata?: Record<string, never>): void {
    ramp.events = [
      ...(ramp.events ?? []),
      {
        id: crypto.randomUUID(),
        eventType,
        username: this.actor.username,
        email: this.actor.email,
        role: this.actor.role,
        createdAt: now(),
        version: ramp.version,
        ...(metadata ? { metadata } : {}),
      },
    ];
  }

  toListItem(ramp: RampRequest): RampListItem {
    return {
      id: ramp.id,
      paymentReference: ramp.paymentReference,
      rampType: ramp.rampType,
      status: ramp.status,
      fiatAmount: ramp.fiatAmount,
      fiatCurrency: ramp.fiatCurrency?.currency,
      cryptoAmount: ramp.cryptoAmount,
      cryptoCurrency: ramp.cryptoCurrency?.currency,
      createdAt: ramp.createdAt,
      createdBy: this.createdBy.get(ramp.id ?? "") ?? "mock-user@example.com",
    };
  }

  listRampRequests(ctx: HandlerContext): RampListItem[] {
    let items = this.rampRequests;
    const { rampType, status, paymentReference } = ctx.query as Record<string, string | undefined>;
    if (rampType) items = items.filter((r) => r.rampType === rampType);
    if (status) items = items.filter((r) => r.status === status);
    if (paymentReference) items = items.filter((r) => r.paymentReference === paymentReference);
    return items.map((r) => this.toListItem(r));
  }

  getRampRequest(ctx: HandlerContext): RampRequest {
    return this.findRamp(ctx);
  }

  createRampRequest(ctx: HandlerContext): RampRequest {
    const b = ctx.body as schemas["CreateRampRequestRequest"];
    if (!b?.rampType) badRequest(ctx, '"rampType" is required.');
    if (typeof b.amount !== "number" || b.amount <= 0) badRequest(ctx, '"amount" must be positive.');
    const fiat = this.fiatCurrencies.find((c) => c.id === b.fiatCurrencyId);
    if (!fiat) badRequest(ctx, `Unknown fiatCurrencyId ${b.fiatCurrencyId}.`);
    const cryp = this.cryptoCurrencies.find((c) => c.id === b.cryptoCurrencyId);
    if (!cryp) badRequest(ctx, `Unknown cryptoCurrencyId ${b.cryptoCurrencyId}.`);

    let companyBankAccount: RampRequest["companyBankAccount"];
    let companyWallet: RampRequest["companyWallet"];
    if (b.rampType === "OFF_RAMP") {
      if (!b.companyBankAccountId) badRequest(ctx, 'OFF_RAMP requires "companyBankAccountId".');
      const account = this.bankAccounts.find((a) => a.id === b.companyBankAccountId);
      if (!account) badRequest(ctx, `Unknown companyBankAccountId ${b.companyBankAccountId}.`);
      if (account.verificationStatus !== "VERIFIED") {
        badRequest(ctx, "The company bank account is not VERIFIED.");
      }
      companyBankAccount = account as unknown as RampRequest["companyBankAccount"];
    } else {
      if (!b.companyWalletId) badRequest(ctx, 'ON_RAMP requires "companyWalletId".');
      const wallet = this.companyWallets.find((w) => w.id === b.companyWalletId);
      if (!wallet) badRequest(ctx, `Unknown companyWalletId ${b.companyWalletId}.`);
      if (wallet.verificationStatus !== "VERIFIED") {
        badRequest(ctx, "The company wallet is not VERIFIED.");
      }
      companyWallet = wallet;
    }

    // ON_RAMP: amount is fiat in → crypto out. OFF_RAMP: amount is crypto
    // in → fiat out. The fee lands on the fiat side, and the two sides
    // relate through the pair's rate - never at parity, so the unit
    // distinction stays visible in every demo figure.
    const rate = this.rateFor(ctx, cryp, fiat);
    const fiatAmount = b.rampType === "OFF_RAMP" ? round2(b.amount * rate) : b.amount;
    const fee = round2((fiatAmount * this.feePercentage) / 100);
    const fiatNetAmount = round2(fiatAmount - fee);
    const ramp: RampRequest = {
      id: crypto.randomUUID(),
      companyId: "co000001-0000-4000-8000-000000000001",
      companyName: "Acme Corporation B.V.",
      rampType: b.rampType,
      status: "AWAITING_APPROVAL",
      fiatAmount,
      fiatNetAmount,
      cryptoAmount: b.rampType === "ON_RAMP" ? round6(fiatNetAmount / rate) : b.amount,
      fiatFeeAmount: fee,
      exchangeRate: rate,
      feePercentage: this.feePercentage,
      paymentReference: `PAY-MOCK-${String(this.rampRequests.length + 1).padStart(6, "0")}`,
      paymentReceived: false,
      createdAt: now(),
      fiatCurrency: fiat,
      cryptoCurrency: cryp,
      companyBankAccount,
      companyWallet,
      // Counterparty instructions: where the money goes for THIS leg.
      depositWallet: b.rampType === "OFF_RAMP" ? this.depositWallets[0] : undefined,
      // Wire truth is bankAccountType "EUR_SEPA"; the generated oneOf
      // discriminator expects DTO type names (contract-hygiene item),
      // hence the boundary cast.
      depositBankAccount:
        b.rampType === "ON_RAMP"
          ? ({
              bankAccountType: "EUR_SEPA",
              name: "Venly deposit account",
              bankName: "Mock Bank AG",
              iban: "DE02120300000000202051",
              bic: "BYLADEM1001",
            } as unknown as RampRequest["depositBankAccount"])
          : undefined,
      events: [],
      version: 0,
      amountReceived: 0,
    };
    this.rampRequests.push(ramp);
    this.createdBy.set(ramp.id as string, this.actor.email);
    this.pushEvent(ramp, "CREATED");
    return ramp;
  }

  private decide(
    ctx: HandlerContext,
    next: "AWAITING_FUNDS" | "REJECTED" | "CANCELLED",
    eventType: RampEvent["eventType"],
  ): RampRequest {
    const ramp = this.findRamp(ctx);
    if (ramp.status !== "AWAITING_APPROVAL") {
      badRequest(ctx, `Only AWAITING_APPROVAL requests can transition; this one is ${ramp.status}.`);
    }
    this.requireVersion(ctx, ramp);
    ramp.status = next;
    ramp.version = (ramp.version ?? 0) + 1;
    this.pushEvent(ramp, eventType);
    this.pushEvent(ramp, "STATUS_CHANGED");
    return ramp;
  }

  approve(ctx: HandlerContext): RampRequest {
    return this.decide(ctx, "AWAITING_FUNDS", "APPROVED");
  }

  reject(ctx: HandlerContext): RampRequest {
    return this.decide(ctx, "REJECTED", "REJECTED");
  }

  cancel(ctx: HandlerContext): RampRequest {
    return this.decide(ctx, "CANCELLED", "CANCELLED");
  }

  setAmount(ctx: HandlerContext): RampRequest {
    const ramp = this.findRamp(ctx);
    if (ramp.status !== "AWAITING_APPROVAL") {
      badRequest(ctx, `Amount can only change while AWAITING_APPROVAL; this one is ${ramp.status}.`);
    }
    this.requireVersion(ctx, ramp);
    const b = ctx.body as schemas["EditRampAmountRequest"];
    if (typeof b.amount !== "number" || b.amount <= 0) badRequest(ctx, '"amount" must be positive.');
    const previous = ramp.rampType === "ON_RAMP" ? ramp.fiatAmount : ramp.cryptoAmount;
    // An amount edit recalculates the other side, at the rate captured on creation.
    const rate = ramp.exchangeRate ?? 1;
    ramp.fiatAmount = ramp.rampType === "OFF_RAMP" ? round2(b.amount * rate) : b.amount;
    const fee = round2((ramp.fiatAmount * (ramp.feePercentage ?? this.feePercentage)) / 100);
    ramp.fiatNetAmount = round2(ramp.fiatAmount - fee);
    ramp.fiatFeeAmount = fee;
    ramp.cryptoAmount = ramp.rampType === "ON_RAMP" ? round6(ramp.fiatNetAmount / rate) : b.amount;
    ramp.version = (ramp.version ?? 0) + 1;
    this.pushEvent(ramp, "AMOUNT_CHANGED", {
      previousAmount: previous,
      newAmount: b.amount,
    } as unknown as Record<string, never>);
    return ramp;
  }

  setTxHash(ctx: HandlerContext, transition: boolean): RampRequest {
    const ramp = this.findRamp(ctx);
    if (ramp.rampType !== "OFF_RAMP") {
      badRequest(ctx, "Only OFF_RAMP requests carry the customer's crypto leg.");
    }
    if (ramp.status !== "AWAITING_FUNDS" && ramp.status !== "PROCESSING") {
      badRequest(ctx, `Transaction hash applies after approval; this one is ${ramp.status}.`);
    }
    this.requireVersion(ctx, ramp);
    const b = ctx.body as schemas["UpdateRampRequestTransactionHashRequest"];
    if (!b.blockchainTransactionHash) badRequest(ctx, '"blockchainTransactionHash" is required.');
    ramp.blockchainTransactionHash = b.blockchainTransactionHash;
    ramp.version = (ramp.version ?? 0) + 1;
    this.pushEvent(ramp, "TX_HASH_ADDED");
    if (transition && ramp.status === "AWAITING_FUNDS") {
      ramp.status = "PROCESSING";
      this.pushEvent(ramp, "STATUS_CHANGED");
    }
    return ramp;
  }

  /**
   * Driver: walk a ramp through the states only the platform (or the
   * counterparty's money arriving) can produce.
   * - "PAYMENT_RECEIVED": ON_RAMP AWAITING_FUNDS → PROCESSING.
   * - "SUCCEEDED" / "FAILED": PROCESSING → terminal.
   * - "BLOCKED" / "DENIED": Venly-admin channels, from any live state.
   */
  advanceRamp(id: string, to: "PAYMENT_RECEIVED" | "SUCCEEDED" | "FAILED" | "BLOCKED" | "DENIED"): void {
    const ramp = this.rampRequests.find((r) => r.id === id);
    if (!ramp) throw new Error(`No ramp request with id ${id}.`);
    if (to === "PAYMENT_RECEIVED") {
      if (ramp.status !== "AWAITING_FUNDS") {
        throw new Error(`PAYMENT_RECEIVED needs AWAITING_FUNDS; ${id} is ${ramp.status}.`);
      }
      ramp.paymentReceived = true;
      ramp.amountReceived = ramp.rampType === "ON_RAMP" ? ramp.fiatAmount : ramp.cryptoAmount;
      ramp.status = "PROCESSING";
      ramp.version = (ramp.version ?? 0) + 1;
      this.pushEvent(ramp, "PAYMENT_RECEIVED");
      this.pushEvent(ramp, "STATUS_CHANGED");
      return;
    }
    if (to === "SUCCEEDED" || to === "FAILED") {
      if (ramp.status !== "PROCESSING") {
        throw new Error(`${to} needs PROCESSING; ${id} is ${ramp.status}.`);
      }
      ramp.status = to;
      ramp.version = (ramp.version ?? 0) + 1;
      this.pushEvent(ramp, to === "SUCCEEDED" ? "COMPLETED" : "FAILED");
      return;
    }
    ramp.status = to;
    ramp.version = (ramp.version ?? 0) + 1;
    this.pushEvent(ramp, "ADMIN_REJECTED");
  }

  // ── Company bank accounts ────────────────────────────────────────────

  listBankAccounts(ctx: HandlerContext): BankAccount[] {
    let items = this.bankAccounts;
    const status = ctx.query.verificationStatus as string | undefined;
    if (status) items = items.filter((a) => a.verificationStatus === status);
    return items;
  }

  getBankAccount(ctx: HandlerContext): BankAccount {
    const account = this.bankAccounts.find((a) => a.id === ctx.params.id);
    if (!account) notFound(ctx, `No company bank account with id ${ctx.params.id}.`);
    return account;
  }

  createBankAccount(ctx: HandlerContext): BankAccount {
    const b = ctx.body as schemas["CreateCompanyBankAccountRequest"] & Record<string, string>;
    for (const field of ["name", "bankName", "companyName", "bankCountry", "supportedRampType"] as const) {
      if (!b?.[field]) badRequest(ctx, `"${field}" is required.`);
    }
    if (b.bankAccountType === "EUR_SEPA" && !b.iban) badRequest(ctx, 'EUR_SEPA requires "iban".');
    if (b.bankAccountType === "OTHER_SWIFT" && !b.accountNumber && !b.iban) {
      badRequest(ctx, 'OTHER_SWIFT requires "accountNumber" or "iban" - one of the two.');
    }
    const account: BankAccount = {
      ...b,
      id: crypto.randomUUID(),
      companyId: "co000001-0000-4000-8000-000000000001",
      // Whitelisting: created PENDING, verified out-of-band. The driver
      // advanceBankAccountVerification stands in for Venly's review.
      verificationStatus: "PENDING",
      createdAt: now(),
      version: 0,
    };
    this.bankAccounts.push(account);
    return account;
  }

  updateBankAccount(ctx: HandlerContext): BankAccount {
    const account = this.getBankAccount(ctx);
    const b = ctx.body as { version?: number; name?: string };
    if (b?.version === undefined) badRequest(ctx, '"version" is required.');
    if (b.version !== account.version) versionConflict(ctx);
    if (b.name) account.name = b.name;
    account.version = (account.version ?? 0) + 1;
    account.updatedAt = now();
    return account;
  }

  advanceBankAccountVerification(id: string, status: "VERIFIED" | "DENIED" = "VERIFIED"): void {
    const account = this.bankAccounts.find((a) => a.id === id);
    if (!account) throw new Error(`No company bank account with id ${id}.`);
    account.verificationStatus = status;
    account.verifiedAt = status === "VERIFIED" ? now() : undefined;
    account.version = (account.version ?? 0) + 1;
  }

  // ── Company wallets ──────────────────────────────────────────────────

  listCompanyWallets(ctx: HandlerContext): CompanyWallet[] {
    let items = this.companyWallets;
    const { verificationStatus, chain, address } = ctx.query as Record<string, string | undefined>;
    if (verificationStatus) items = items.filter((w) => w.verificationStatus === verificationStatus);
    if (chain) items = items.filter((w) => w.chain === chain);
    if (address) items = items.filter((w) => w.address === address);
    return items;
  }

  getCompanyWallet(ctx: HandlerContext): CompanyWallet {
    const wallet = this.companyWallets.find((w) => w.id === ctx.params.id);
    if (!wallet) notFound(ctx, `No company wallet with id ${ctx.params.id}.`);
    return wallet;
  }

  createCompanyWallet(ctx: HandlerContext): CompanyWallet {
    const b = ctx.body as schemas["CreateCompanyWalletRequest"];
    if (!b?.address) badRequest(ctx, '"address" is required.');
    if (!b?.chain) badRequest(ctx, '"chain" is required.');
    const wallet: CompanyWallet = {
      id: crypto.randomUUID(),
      address: b.address,
      chain: b.chain,
      description: b.description,
      verificationStatus: "PENDING",
      createdAt: now(),
      version: 0,
    };
    this.companyWallets.push(wallet);
    return wallet;
  }

  updateCompanyWallet(ctx: HandlerContext): CompanyWallet {
    const wallet = this.getCompanyWallet(ctx);
    const b = ctx.body as { version?: number; description?: string };
    if (b?.version === undefined) badRequest(ctx, '"version" is required.');
    if (b.version !== wallet.version) versionConflict(ctx);
    if (b.description !== undefined) wallet.description = b.description;
    wallet.version = (wallet.version ?? 0) + 1;
    return wallet;
  }

  advanceCompanyWalletVerification(id: string, status: "VERIFIED" | "DENIED" = "VERIFIED"): void {
    const wallet = this.companyWallets.find((w) => w.id === id);
    if (!wallet) throw new Error(`No company wallet with id ${id}.`);
    wallet.verificationStatus = status;
    wallet.version = (wallet.version ?? 0) + 1;
  }
}

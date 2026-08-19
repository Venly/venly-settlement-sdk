import type { components } from "../generated/finance.js";
import { financeResponseShapes } from "../generated/finance-shapes.js";
import { mockError, type HandlerContext } from "./transport.js";
import { Ledger, MockLedgerError, type FundsPhase, type LedgerLeg, type LedgerSnapshot } from "./ledger.js";
import {
  EventLog,
  deterministicClock,
  deterministicIds,
  systemClock,
  systemIds,
  type MockClock,
  type MockEvent,
  type MockIdSource,
} from "./runtime.js";

type schemas = components["schemas"];
type Party = schemas["PartyDto"];
type Account = schemas["AccountListItemDto"];
type Wallet = schemas["WalletBalanceDto"];
type PartyRole = schemas["PartyRoleDto"];
type VirtualBankAccount = schemas["VirtualBankAccountResponse"];
type Transfer = schemas["TransferRequestDto"];
type PaymentSession = schemas["PayInSessionDto"];
type PayoutBankAccount = schemas["PayoutBankAccountDto"];
type PayoutRoute = schemas["PayoutRouteDto"];
type Payout = schemas["PayoutDto"];
type SupportedAsset = schemas["SupportedAssetView"];
type AccountSupportedAsset = schemas["AccountSupportedAssetView"];

/**
 * A simulated inbound bank credit. The Finance API models no such resource:
 * this exists only so the mock can make money arrive, the way advanceTransfer
 * exists only so a transfer can settle. Never surface it as an API response.
 */
export interface MockInboundCredit {
  id: string;
  virtualBankAccountId: string;
  referenceCode: string | null;
  amount: number;
  currency: string;
  receivedAt: string;
}

/** Seed data the store starts from (and returns to on `reset()`). */
export interface FinanceSeeds {
  parties: Party[];
  accounts: Account[];
  /** Wallets per account id. Accounts absent here have no wallet yet. */
  wallets: Record<string, Wallet[]>;
  partyRole: PartyRole;
  virtualBankAccounts: VirtualBankAccount[];
  transfers: Transfer[];
  /** Beneficiary bank accounts per party (flat; each row carries partyId). */
  payoutBankAccounts: PayoutBankAccount[];
  /** Payout routes per account id (routes carry no accountId on the wire). */
  payoutRoutes: Record<string, PayoutRoute[]>;
  payouts: Payout[];
  /** Tenant-wide supported assets; `decimals` must be each asset's real on-chain value. */
  supportedAssets: SupportedAsset[];
  /** Account-scoped rows (adds permitStatus) per account id. */
  accountSupportedAssets: Record<string, AccountSupportedAsset[]>;
  /** Party IV verifications. A party with no row reads as NOT_LINKED. */
  ivVerifications?: schemas["PartyIvVerificationDto"][];
}

/** Contract status -> what the money did. The full tables live in the spec. */
const TRANSFER_PHASE: Record<string, FundsPhase> = {
  PENDING: "HELD",
  COMPLETED: "DEBITED",
  FAILED: "RELEASED",
};

const PAYOUT_PHASE: Record<string, FundsPhase> = {
  REQUESTED: "HELD",
  SENDING: "DEBITED",
  PROVIDER_PROCESSING: "DEBITED",
  COMPLETED: "DEBITED",
  REJECTED: "RELEASED",
  FAILED: "RELEASED",
  RETURNED: "RETURNED",
};

/** 402/insufficient-funds, matching the mock's own `INSUFFICIENT_FUNDS` preset. */
function insufficientFunds(ctx: HandlerContext, message: string): never {
  mockError({ status: 402, code: "insufficient-funds", message }, ctx.method, ctx.path);
}

export type VerificationStatusInput =
  | "VERIFICATION_PENDING"
  | "PENDING"
  | "VERIFIED"
  | "REJECTED"
  | "DENIED";

/** Options a caller may hand the store; every default preserves today's behaviour. */
export interface FinanceMockStoreOptions {
  clock?: MockClock;
  ids?: MockIdSource;
  /** Fixed clock + counter ids, so a scripted run replays deep-equal. */
  deterministic?: boolean;
  events?: EventLog;
}

/** Keep only the fields the route's response schema actually declares. */
function toResponseShape<T extends Record<string, unknown>>(routeKey: string, entity: T): T {
  const allowed = financeResponseShapes[routeKey];
  if (!allowed) return entity;
  const out: Record<string, unknown> = {};
  for (const key of allowed) {
    if (entity[key] !== undefined) out[key] = entity[key];
  }
  return out as T;
}

function badRequest(ctx: HandlerContext, message: string): never {
  mockError({ status: 400, code: "invalid-request", message }, ctx.method, ctx.path);
}

function idempotencyConflict(ctx: HandlerContext): never {
  mockError(
    {
      status: 409,
      code: "concurrent-modification",
      message: "This request conflicts with an earlier use of the same idempotency key.",
    },
    ctx.method,
    ctx.path,
  );
}

function requestFingerprint(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(requestFingerprint).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${requestFingerprint(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function notFound(ctx: HandlerContext, code: string, message: string): never {
  mockError({ status: 404, code, message }, ctx.method, ctx.path);
}

function versionConflict(ctx: HandlerContext): never {
  mockError(
    {
      status: 409,
      code: "concurrent-modification",
      message: "This request has been modified by another user. Please refresh and retry.",
    },
    ctx.method,
    ctx.path,
  );
}

/** Generic scalar-equality filters from query params (page/size excluded). */
function applyQueryFilters<T extends Record<string, unknown>>(
  items: T[],
  query: HandlerContext["query"],
  keys: string[],
): T[] {
  let out = items;
  for (const key of keys) {
    const wanted = query[key];
    if (wanted === undefined) continue;
    out = out.filter((item) => String(item[key]) === String(wanted));
  }
  return out;
}

/**
 * Stateful fixture store behind mock mode. Creates mint real ids and are
 * readable back through `get`/`list`; verification starts pending and
 * transfers start `PENDING`, each with an explicit way to advance – so the
 * mock teaches the lifecycle the documentation describes instead of skipping
 * to the happy end.
 */
export class FinanceMockStore {
  parties: Party[] = [];
  accounts: Account[] = [];
  wallets = new Map<string, Wallet[]>();
  rolesByAccount = new Map<string, PartyRole[]>();
  virtualBankAccounts: VirtualBankAccount[] = [];
  transfers: Transfer[] = [];
  paymentSessions: PaymentSession[] = [];
  inboundCredits: MockInboundCredit[] = [];
  payoutBankAccounts: PayoutBankAccount[] = [];
  payoutRoutes = new Map<string, PayoutRoute[]>();
  payouts: Payout[] = [];
  supportedAssets: SupportedAsset[] = [];
  accountSupportedAssets = new Map<string, AccountSupportedAsset[]>();
  private payoutIntents = new Map<string, {
    fingerprint: string;
    outcome: "failed" | "succeeded";
    result?: Payout;
  }>();
  private transferIntents = new Map<string, {
    fingerprint: string;
    outcome: "failed" | "succeeded";
    result?: Transfer;
  }>();
  private virtualBankAccountIntents = new Map<string, {
    fingerprint: string;
    outcome: "failed" | "succeeded";
    result?: VirtualBankAccount;
  }>();

  /** Party IV verification, keyed by partyId. Absent reads as NOT_LINKED. */
  ivVerifications = new Map<string, schemas["PartyIvVerificationDto"]>();

  private counter = 0;
  private readonly seeds: FinanceSeeds;
  private clock: MockClock;
  private ids: MockIdSource;
  readonly ledger: Ledger;
  events: EventLog;
  /** Set by the transport so a mutation can replicate itself. */
  onMutation: (() => void) | undefined;

  constructor(seeds: FinanceSeeds, options: FinanceMockStoreOptions = {}) {
    this.seeds = seeds;
    this.clock = options.clock ?? (options.deterministic ? deterministicClock() : systemClock);
    this.ids = options.ids ?? (options.deterministic ? deterministicIds() : systemIds);
    this.events = options.events ?? new EventLog("local", () => this.clock);
    this.ledger = new Ledger(() => this.wallets, () => this.supportedAssets);
    this.reset();
  }

  private now(): string {
    return this.clock.now();
  }

  private mintAddress(): string {
    return this.ids.next("address");
  }

  private mintHash(): string {
    return this.ids.next("hash");
  }

  /** Emit, then replicate. Both happen only after the mutation has succeeded. */
  private emit(input: Parameters<EventLog["emit"]>[0]): void {
    this.events.emit(input);
  }

  /** Restore the seed fixtures, discarding everything created since. */
  reset(): void {
    const s = structuredClone(this.seeds);
    this.parties = s.parties;
    this.accounts = s.accounts;
    this.wallets = new Map(Object.entries(s.wallets));
    this.rolesByAccount = new Map(s.accounts.map((a) => [a.id as string, [{ ...s.partyRole }]]));
    this.virtualBankAccounts = s.virtualBankAccounts;
    this.transfers = s.transfers;
    this.paymentSessions = [];
    this.inboundCredits = [];
    this.payoutBankAccounts = s.payoutBankAccounts;
    this.payoutRoutes = new Map(Object.entries(s.payoutRoutes));
    this.payouts = s.payouts;
    this.supportedAssets = s.supportedAssets;
    this.accountSupportedAssets = new Map(Object.entries(s.accountSupportedAssets));
    this.virtualBankAccountIntents.clear();
    this.transferIntents.clear();
    this.payoutIntents.clear();
    this.payoutProofWallets.clear();
    this.counter = 0;
    this.ivVerifications = new Map(
      (s.ivVerifications ?? []).map((iv) => [iv.partyId as string, iv] as const),
    );
    this.ledger.reset();
    this.hydrateLedger();
    // A seed that cannot satisfy the invariants is a fixture teaching a
    // falsehood, and it fails here rather than halfway through a demo.
    this.ledger.verify();
  }

  /**
   * Seeded balances are the *post* state, so hydration records each seeded
   * money object at the phase its status implies and posts no delta. I5 then
   * checks that every reserve has a hold behind it.
   */
  private hydrateLedger(): void {
    for (const transfer of this.transfers) {
      if (!transfer.id || !transfer.asset || transfer.amount === undefined) continue;
      const phase = TRANSFER_PHASE[transfer.status ?? "PENDING"];
      if (transfer.senderAccountId) {
        this.ledger.hydrateHold(
          transfer.id,
          transfer.senderAccountId,
          transfer.asset,
          transfer.amount,
          phase,
        );
      }
      if (transfer.status === "COMPLETED" && transfer.receiverAccountId) {
        this.ledger.hydrateCredit(
          transfer.id,
          transfer.receiverAccountId,
          transfer.asset,
          transfer.amount,
        );
      }
    }
    for (const payout of this.payouts) {
      const asset = payout.payoutRoute?.depositAsset?.name;
      if (!payout.id || !payout.accountId || !asset || payout.cryptoAmount === undefined) continue;
      if (payout.fundingMode !== "PULL") continue;
      this.ledger.hydrateHold(
        payout.id,
        payout.accountId,
        asset,
        payout.cryptoAmount,
        PAYOUT_PHASE[payout.status ?? "REQUESTED"],
      );
    }
  }

  private mintId(): string {
    this.counter += 1;
    return this.ids.next("id");
  }

  // ── Parties ──────────────────────────────────────────────────────────

  listParties(ctx: HandlerContext): Party[] {
    return applyQueryFilters(
      this.parties as Record<string, unknown>[],
      ctx.query,
      ["externalId", "partyType", "status"],
    ) as Party[];
  }

  createParty(ctx: HandlerContext): Party {
    const b = ctx.body as schemas["CreatePartyRequest"];
    let party: Party;
    if (b.partyType === "INDIVIDUAL") {
      if (!b.firstName || !b.lastName) {
        badRequest(ctx, 'INDIVIDUAL parties require "firstName" and "lastName".');
      }
      if (b.name !== undefined || b.vatNumber !== undefined) {
        badRequest(ctx, '"name"/"vatNumber" belong to ORGANISATION parties, not INDIVIDUAL.');
      }
      party = {
        id: this.mintId(),
        externalId: b.externalId,
        partyType: "INDIVIDUAL",
        status: "ACTIVE",
        firstName: b.firstName,
        lastName: b.lastName,
        // Matches the documented lifecycle: creation starts verification, a
        // Venly admin completes it. Advance with mock.advanceVerification(id).
        kycStatus: "VERIFICATION_PENDING",
        address: b.address,
        createdAt: this.now(),
        version: 0,
      };
    } else if (b.partyType === "ORGANISATION") {
      if (!b.name) {
        badRequest(ctx, 'ORGANISATION parties require "name".');
      }
      if (b.firstName !== undefined || b.lastName !== undefined) {
        badRequest(ctx, '"firstName"/"lastName" belong to INDIVIDUAL parties, not ORGANISATION.');
      }
      party = {
        id: this.mintId(),
        externalId: b.externalId,
        partyType: "ORGANISATION",
        status: "ACTIVE",
        name: b.name,
        vatNumber: b.vatNumber,
        kybStatus: "PENDING",
        address: b.address,
        createdAt: this.now(),
        version: 0,
      };
    } else {
      badRequest(ctx, `Unknown partyType "${String(b.partyType)}". Use INDIVIDUAL or ORGANISATION.`);
    }
    this.parties.push(party);
    return toResponseShape("POST /parties", party as Record<string, unknown>) as Party;
  }

  getParty(ctx: HandlerContext): Party {
    const party = this.parties.find((p) => p.id === ctx.params.partyId);
    if (!party) notFound(ctx, "party-not-found", `No party with id ${ctx.params.partyId}.`);
    return party;
  }

  updateParty(ctx: HandlerContext): Party {
    const party = this.getParty(ctx);
    const b = ctx.body as schemas["UpdatePartyRequest"] & Record<string, unknown>;
    if (b.version !== (party.version ?? 0)) versionConflict(ctx);
    for (const [key, value] of Object.entries(b)) {
      if (key === "version" || value === undefined) continue;
      (party as Record<string, unknown>)[key] = value;
    }
    party.version = (party.version ?? 0) + 1;
    party.updatedAt = this.now();
    return party;
  }

  deleteParty(ctx: HandlerContext): undefined {
    const idx = this.parties.findIndex((p) => p.id === ctx.params.partyId);
    if (idx === -1) notFound(ctx, "party-not-found", `No party with id ${ctx.params.partyId}.`);
    this.parties.splice(idx, 1);
    return undefined;
  }

  // ── Accounts ─────────────────────────────────────────────────────────

  listAccounts(ctx: HandlerContext): Account[] {
    return applyQueryFilters(
      this.accounts as Record<string, unknown>[],
      ctx.query,
      ["externalId", "status", "kycStatus"],
    ) as Account[];
  }

  createAccount(ctx: HandlerContext): Account {
    const b = ctx.body as schemas["CreateAccountRequest"];
    const account: Account = {
      id: this.mintId(),
      externalId: b.externalId,
      name: b.name,
      // Documented lifecycle: a new account starts VERIFICATION_PENDING and a
      // Venly admin approves it. Advance with mock.advanceVerification(id).
      kycStatus: "VERIFICATION_PENDING",
      status: "ACTIVE",
      createdAt: this.now(),
      version: 0,
    };
    this.accounts.push(account);
    this.rolesByAccount.set(account.id as string, []);
    if (b.partyId) {
      this.rolesByAccount
        .get(account.id as string)!
        .push({ partyId: b.partyId, roleType: "ACCOUNT_HOLDER", status: "ACTIVE" });
    }
    // The live API provisions the wallet as a side effect of account
    // creation; contract 1.3.0 exposes it only as balance rows, and a fresh
    // wallet holds nothing.
    this.wallets.set(account.id as string, []);
    return toResponseShape("POST /accounts", account as Record<string, unknown>) as Account;
  }

  getAccount(ctx: HandlerContext, id = ctx.params.accountId): Account {
    const account = this.accounts.find((a) => a.id === id);
    if (!account) notFound(ctx, "account-not-found", `No account with id ${id}.`);
    return account;
  }

  listWallets(ctx: HandlerContext): Wallet[] {
    this.getAccount(ctx);
    return this.wallets.get(ctx.params.accountId) ?? [];
  }

  listSupportedAssets(): SupportedAsset[] {
    return this.supportedAssets;
  }

  listAccountSupportedAssets(ctx: HandlerContext): AccountSupportedAsset[] {
    this.getAccount(ctx);
    const seeded = this.accountSupportedAssets.get(ctx.params.accountId);
    if (seeded) return seeded;
    // Mock assumption: an account the seeds don't cover exposes the tenant's
    // asset list with a permit status derived from whether it holds a wallet
    // yet – NO_WALLET before provisioning, PENDING after. The live API may
    // scope the list differently; treat this as a fixture, not a contract.
    const hasWallet = (this.wallets.get(ctx.params.accountId) ?? []).length > 0;
    return this.supportedAssets.map((asset) => ({
      ...asset,
      permitStatus: hasWallet ? ("PENDING" as const) : ("NO_WALLET" as const),
    }));
  }

  listPartyRoles(ctx: HandlerContext): PartyRole[] {
    this.getAccount(ctx);
    return this.rolesByAccount.get(ctx.params.accountId) ?? [];
  }

  addPartyRole(ctx: HandlerContext): PartyRole {
    this.getAccount(ctx);
    const b = ctx.body as schemas["AddPartyRoleRequest"];
    const role: PartyRole = { partyId: b.partyId, roleType: b.roleType, status: "ACTIVE" };
    const roles = this.rolesByAccount.get(ctx.params.accountId) ?? [];
    roles.push(role);
    this.rolesByAccount.set(ctx.params.accountId, roles);
    return role;
  }

  removePartyRole(ctx: HandlerContext): undefined {
    this.getAccount(ctx);
    const roles = this.rolesByAccount.get(ctx.params.accountId) ?? [];
    const idx = roles.findIndex((r) => r.partyId === ctx.params.partyId);
    if (idx === -1) {
      notFound(ctx, "party-not-found", `No party role for ${ctx.params.partyId} on this account.`);
    }
    roles.splice(idx, 1);
    return undefined;
  }

  // ── Virtual bank accounts ────────────────────────────────────────────

  listVirtualBankAccounts(ctx: HandlerContext): VirtualBankAccount[] {
    this.getAccount(ctx);
    return this.virtualBankAccounts.filter((v) => v.accountId === ctx.params.accountId);
  }

  createVirtualBankAccount(
    ctx: HandlerContext,
  ): schemas["IdempotentResponseVirtualBankAccountResponse"] {
    const account = this.getAccount(ctx);
    const b = ctx.body as schemas["CreateVirtualBankAccountRequest"];
    const intentKey = `${account.id}:${ctx.idempotencyKey ?? b.idempotencyKey}`;
    const fingerprint = requestFingerprint(b);
    const existing = this.virtualBankAccountIntents.get(intentKey);
    if (existing) {
      if (existing.outcome === "failed" || existing.fingerprint !== fingerprint || !existing.result) {
        idempotencyConflict(ctx);
      }
      return toResponseShape(
        "POST /accounts/{accountId}/virtual-bank-accounts",
        {
          createdResourceId: (existing.result as VirtualBankAccount).id,
          response: existing.result,
        } as Record<string, unknown>,
      ) as schemas["IdempotentResponseVirtualBankAccountResponse"];
    }
    if (account.status !== "ACTIVE" || account.kycStatus !== "VERIFIED") {
      this.virtualBankAccountIntents.set(intentKey, { fingerprint, outcome: "failed" });
      badRequest(ctx, "Virtual bank accounts require an active, verified account.");
    }
    this.counter += 1;
    const vba: VirtualBankAccount = {
      id: this.mintId(),
      accountId: account.id,
      bankAccountType: "EUR_SEPA",
      name: b.name,
      status: "ACTIVE",
      currency: b.inCurrency as VirtualBankAccount["currency"],
      targetCryptocurrency: b.targetCryptocurrency as VirtualBankAccount["targetCryptocurrency"],
      iban: `DE89370400440532${String(this.counter).padStart(6, "0")}`,
      bic: "DEUTDEDBFRA",
      bankName: "Example Bank N.V.",
      beneficiaryName: account.name ?? "Account holder",
      referenceCode: `REF-MOCK-${String(this.counter).padStart(3, "0")}`,
      createdAt: this.now(),
    };
    this.virtualBankAccounts.push(vba);
    this.virtualBankAccountIntents.set(intentKey, { fingerprint, outcome: "succeeded", result: vba });
    // Contract 1.3.0: creates return the idempotent wrapper, not the bare resource.
    return toResponseShape(
      "POST /accounts/{accountId}/virtual-bank-accounts",
      { createdResourceId: vba.id, response: vba } as Record<string, unknown>,
    ) as schemas["IdempotentResponseVirtualBankAccountResponse"];
  }

  getVirtualBankAccount(ctx: HandlerContext): VirtualBankAccount {
    this.getAccount(ctx);
    const vba = this.virtualBankAccounts.find(
      (v) => v.id === ctx.params.virtualBankAccountId && v.accountId === ctx.params.accountId,
    );
    if (!vba) {
      notFound(
        ctx,
        "virtual-bank-account-not-found",
        `No virtual bank account ${ctx.params.virtualBankAccountId} on account ${ctx.params.accountId}.`,
      );
    }
    return vba;
  }

  // ── Transfers ────────────────────────────────────────────────────────

  private resolveReceiver(ctx: HandlerContext, b: {
    receiverAccountId?: string;
    receiverExternalId?: string;
  }): { receiverAccountId?: string; receiverExternalId?: string } {
    const hasId = b.receiverAccountId !== undefined;
    const hasExternal = b.receiverExternalId !== undefined;
    if (hasId === hasExternal) {
      badRequest(
        ctx,
        'Provide exactly one of "receiverAccountId" or "receiverExternalId" on a transfer.',
      );
    }
    if (hasId) {
      this.getAccount(ctx, b.receiverAccountId);
      return { receiverAccountId: b.receiverAccountId };
    }
    const receiver = this.accounts.find((a) => a.externalId === b.receiverExternalId);
    if (!receiver) {
      notFound(ctx, "account-not-found", `No account with externalId ${b.receiverExternalId}.`);
    }
    return { receiverAccountId: receiver.id, receiverExternalId: b.receiverExternalId };
  }

  /**
   * Replay parity with `requestPayout`: same key + same body returns the
   * original resource, same key + different body is a 409, and a failed intent
   * stays failed. Before this, both creators stored `idempotencyKey` on the
   * resource and never read it, so a retried send created a second transfer -
   * and now that money actually moves, a second debit.
   */
  private transferIntent(
    ctx: HandlerContext,
    senderId: string,
    body: { idempotencyKey?: string },
  ): { replay?: Transfer; commit: (t: Transfer) => void; fail: () => never } {
    const key = ctx.idempotencyKey ?? body.idempotencyKey;
    const intentKey = `${senderId}:${key}`;
    const fingerprint = requestFingerprint(body);
    const existing = key === undefined ? undefined : this.transferIntents.get(intentKey);
    if (existing) {
      if (existing.outcome === "failed" || existing.fingerprint !== fingerprint || !existing.result) {
        idempotencyConflict(ctx);
      }
      return { replay: existing.result, commit: () => {}, fail: () => idempotencyConflict(ctx) };
    }
    return {
      commit: (transfer) => {
        if (key !== undefined) {
          this.transferIntents.set(intentKey, { fingerprint, outcome: "succeeded", result: transfer });
        }
      },
      fail: () => {
        if (key !== undefined) this.transferIntents.set(intentKey, { fingerprint, outcome: "failed" });
        return undefined as never;
      },
    };
  }

  /**
   * Reserve the amount against the sender and record the transfer. The hold is
   * what makes `available` mean something: a UI reading `total` as spendable
   * now disagrees with the API.
   */
  private postTransfer(ctx: HandlerContext, transfer: Transfer, routeKey: string): Transfer {
    const asset = transfer.asset as string;
    const sender = transfer.senderAccountId as string;
    try {
      this.ledger.movePhase(
        transfer.id as string,
        "HELD",
        { accountId: sender, asset, amount: transfer.amount as number },
        `transfer ${transfer.id}`,
      );
    } catch (error) {
      if (error instanceof MockLedgerError) {
        insufficientFunds(ctx, error.message);
      }
      throw error;
    }
    this.transfers.push(transfer);
    this.transferIntents.set(
      `${sender}:${ctx.idempotencyKey ?? (ctx.body as { idempotencyKey?: string })?.idempotencyKey}`,
      { fingerprint: requestFingerprint(ctx.body), outcome: "succeeded", result: transfer },
    );
    this.emit({
      type: "transfer.created",
      resource: { kind: "transfer", id: transfer.id as string },
      accountId: sender,
      data: transfer,
    });
    this.emitBalance(sender, asset);
    return toResponseShape(routeKey, transfer as Record<string, unknown>) as Transfer;
  }

  /** Emitted after the causing event, so a balance-only subscriber is correct. */
  private emitBalance(accountId: string, asset: string): void {
    const row = (this.wallets.get(accountId) ?? []).find((w) => w.asset === asset);
    if (!row) return;
    this.emit({
      type: "wallet.balance_changed",
      resource: { kind: "wallet", id: `${accountId}:${asset}` },
      accountId,
      data: { accountId, asset, amount: row.amount },
    });
  }

  createFiatTransfer(ctx: HandlerContext): Transfer {
    const sender = this.getAccount(ctx, ctx.params.senderAccountId);
    const b = ctx.body as schemas["CreateFiatTransferInput"];
    const intent = this.transferIntent(ctx, sender.id as string, b);
    if (intent.replay) {
      return toResponseShape(
        "POST /accounts/{senderAccountId}/transfers/fiat",
        intent.replay as Record<string, unknown>,
      ) as Transfer;
    }
    const receiver = this.resolveReceiver(ctx, b);
    const transfer: Transfer = {
      id: this.mintId(),
      senderAccountId: sender.id,
      ...receiver,
      chain: "BASE",
      asset: b.currency === "EUR" ? "EURC" : "USDC",
      amount: b.amount,
      fiatOrigin: { amount: b.amount, currency: b.currency },
      description: b.description,
      merchantReference: b.merchantReference,
      idempotencyKey: b.idempotencyKey,
      // Transfers settle asynchronously; poll get() or use
      // mock.advanceTransfer(id) to move PENDING → COMPLETED (or FAILED).
      status: "PENDING",
      createdAt: this.now(),
    };
    return this.postTransfer(ctx, transfer, "POST /accounts/{senderAccountId}/transfers/fiat");
  }

  createCryptoTransfer(ctx: HandlerContext): Transfer {
    const sender = this.getAccount(ctx, ctx.params.senderAccountId);
    const b = ctx.body as schemas["CreateCryptoTransferInput"];
    const intent = this.transferIntent(ctx, sender.id as string, b);
    if (intent.replay) {
      return toResponseShape(
        "POST /accounts/{senderAccountId}/transfers/crypto",
        intent.replay as Record<string, unknown>,
      ) as Transfer;
    }
    const receiver = this.resolveReceiver(ctx, b);
    const transfer: Transfer = {
      id: this.mintId(),
      senderAccountId: sender.id,
      ...receiver,
      chain: b.chain,
      asset: b.asset,
      amount: b.amount,
      description: b.description,
      merchantReference: b.merchantReference,
      idempotencyKey: b.idempotencyKey,
      status: "PENDING",
      createdAt: this.now(),
    };
    return this.postTransfer(ctx, transfer, "POST /accounts/{senderAccountId}/transfers/crypto");
  }

  listTransfers(ctx: HandlerContext): Transfer[] {
    const accountId = ctx.params.accountId;
    this.getAccount(ctx);
    let items = this.transfers.filter(
      (t) => t.senderAccountId === accountId || t.receiverAccountId === accountId,
    );
    const role = ctx.query.accountRole;
    if (role === "SENDER") items = items.filter((t) => t.senderAccountId === accountId);
    if (role === "RECEIVER") items = items.filter((t) => t.receiverAccountId === accountId);
    if (ctx.query.status !== undefined) {
      items = items.filter((t) => t.status === ctx.query.status);
    }
    return items;
  }

  getTransfer(ctx: HandlerContext): Transfer {
    const accountId = ctx.params.accountId;
    this.getAccount(ctx);
    const transfer = this.transfers.find(
      (t) =>
        t.id === ctx.params.transferId &&
        (t.senderAccountId === accountId || t.receiverAccountId === accountId),
    );
    if (!transfer) {
      notFound(
        ctx,
        "transfer-not-found",
        `No transfer ${ctx.params.transferId} involving account ${accountId}.`,
      );
    }
    return transfer;
  }

  // ── Lifecycle controls (exposed via client.mock) ─────────────────────

  advanceVerification(id: string, status: VerificationStatusInput = "VERIFIED"): void {
    const party = this.parties.find((p) => p.id === id);
    if (party) {
      if (party.partyType === "ORGANISATION") {
        party.kybStatus = (status === "REJECTED" ? "DENIED" : status) as Party["kybStatus"];
      } else {
        party.kycStatus = (status === "PENDING"
          ? "VERIFICATION_PENDING"
          : status) as Party["kycStatus"];
      }
      party.updatedAt = this.now();
      return;
    }
    const account = this.accounts.find((a) => a.id === id);
    if (account) {
      account.kycStatus = (status === "PENDING"
        ? "VERIFICATION_PENDING"
        : status) as Account["kycStatus"];
      account.version = (account.version ?? 0) + 1;
      return;
    }
    throw new Error(`advanceVerification: no party or account with id ${id} in the mock store.`);
  }

  advanceTransfer(id: string, status: "COMPLETED" | "FAILED" = "COMPLETED"): void {
    const transfer = this.transfers.find((t) => t.id === id);
    if (!transfer) {
      throw new Error(`advanceTransfer: no transfer with id ${id} in the mock store.`);
    }
    const previous = transfer.status;
    const asset = transfer.asset as string;
    const amount = transfer.amount as number;
    const sender = transfer.senderAccountId as string;
    // The receiver only exists in the ledger if it is an account this mock
    // knows; a transfer out to an external counterparty legitimately has no
    // credit leg, and `sum(total)` moves by the amount (an external outflow).
    const receiver = transfer.receiverAccountId;
    const receiverKnown =
      receiver !== undefined && this.accounts.some((a) => a.id === receiver);

    // Both legs are computed and validated before either is applied. A refused
    // credit reversal must not leave the sender's release standing, or
    // `sum(total)` drifts up by the amount - a conservation breach created by
    // the rule that exists to stop a negative balance.
    const creditLegs: LedgerLeg[] = receiverKnown
      ? this.ledger.creditLegs(
          id,
          status === "COMPLETED" ? "CREDITED" : "NONE",
          { accountId: receiver as string, asset, amount },
          `transfer ${id} receiver leg`,
        )
      : [];

    this.ledger.movePhase(
      id,
      TRANSFER_PHASE[status],
      { accountId: sender, asset, amount },
      `transfer ${id}`,
      creditLegs,
    );
    if (receiverKnown) {
      this.ledger.commitCredit(id, status === "COMPLETED" ? "CREDITED" : "NONE", {
        accountId: receiver as string,
        asset,
        amount,
      });
    }

    transfer.status = status;
    if (status === "COMPLETED") transfer.transactionHash = this.mintHash();
    if (status === "FAILED") {
      transfer.errorMessage = transfer.errorMessage ?? "Insufficient available balance";
    }
    transfer.updatedAt = this.now();
    this.emit({
      type: "transfer.status_changed",
      resource: { kind: "transfer", id },
      accountId: sender,
      previous: { status: previous },
      data: transfer,
    });
    this.emitBalance(sender, asset);
    if (receiverKnown) this.emitBalance(receiver as string, asset);
  }

  createPaymentSession(ctx: HandlerContext): PaymentSession {
    const b = ctx.body as schemas["CreatePayInSessionInput"];
    const id = this.mintId();
    const session: PaymentSession = {
      id,
      createdAt: this.now(),
      updatedAt: this.now(),
      status: "CREATED",
      inAmount: Number(b.inAmount),
      inCurrency: b.inCurrency,
      outCryptocurrency: b.outCryptocurrency,
      idempotencyKey: b.idempotencyKey,
      // The hosted checkout the payer is sent to. Without it the session is
      // unusable - it is the only thing an integrator can actually do with one.
      paymentUrl: `https://pay.venlyfinance.com/s/${id.slice(0, 8)}`,
      accountId: ctx.params.accountId,
      cancellable: true,
    };
    this.paymentSessions.push(session);
    return session;
  }

  /**
   * Returns the updated session. The Finance API exposes no GET for a payment
   * session - only POST, with the outcome delivered to `callbackUrl` - so a
   * caller has no other way to observe what this driver did.
   */
  advancePaymentSession(id: string, to: NonNullable<schemas["PayInSessionDto"]["status"]>): PaymentSession {
    const session = this.paymentSessions.find((s) => s.id === id);
    if (!session) {
      throw new Error(`advancePaymentSession: no payment session with id ${id} in the mock store.`);
    }
    session.status = to;
    session.updatedAt = this.now();
    return session;
  }

  /**
   * Mock-only driver: simulate an inbound bank credit landing on a VBA.
   * The Finance API models no such resource — this exists only so tests can
   * assert that money arrived, the way advanceTransfer exists for transfers.
   *
   * referenceCode defaults to the VBA own referenceCode (or null). Pass null
   * explicitly to simulate an unmatched credit — see MG-5 / J6 reconciliation.
   */
  simulateInboundCredit(
    virtualBankAccountId: string,
    amount: number,
    referenceCode?: string | null | undefined,
  ): MockInboundCredit {
    const vba = this.virtualBankAccounts.find((v) => v.id === virtualBankAccountId);
    if (!vba) {
      throw new Error(
        `simulateInboundCredit: no virtual bank account with id ${virtualBankAccountId} in the mock store.`,
      );
    }
    // Every field on the generated VirtualBankAccount is optional, so a currency
    // is not guaranteed. Refuse rather than default: a credit denominated in a
    // currency the account never declared is a fixture teaching a falsehood,
    // which is the MG-11 rule.
    if (!vba.currency) {
      throw new Error(
        `simulateInboundCredit: virtual bank account ${virtualBankAccountId} has no currency, so nothing can land on it.`,
      );
    }
    // The asset is the VBA's DECLARED target, never a guess from the fiat
    // currency: the seeded EUR account targets USDC, so a currency->stablecoin
    // mapping would credit the wrong coin - a fixture teaching a falsehood.
    const asset = vba.targetCryptocurrency;
    if (!asset) {
      throw new Error(
        `simulateInboundCredit: virtual bank account ${virtualBankAccountId} declares no ` +
          `targetCryptocurrency, so the mock cannot know which asset the credit converts to.`,
      );
    }
    const credit: MockInboundCredit = {
      id: this.mintId(),
      virtualBankAccountId,
      referenceCode:
        referenceCode === undefined ? (vba.referenceCode ?? null) : referenceCode,
      amount,
      currency: vba.currency,
      receivedAt: this.now(),
    };
    const accountId = vba.accountId as string;
    this.ledger.applyAtomic([
      {
        accountId,
        asset,
        deltaTotal: this.ledger.toMinor(asset, amount),
        deltaAvailable: this.ledger.toMinor(asset, amount),
        deltaReserved: 0n,
        createIfMissing: true,
        because: `inbound credit on ${virtualBankAccountId}`,
      },
    ]);
    this.inboundCredits.push(credit);
    this.emit({
      type: "inbound_credit.received",
      resource: { kind: "inboundCredit", id: credit.id },
      accountId,
      data: credit,
    });
    this.emitBalance(accountId, asset);
    return credit;
  }

  /** Return inbound credits, optionally filtered by VBA, newest first. */
  listInboundCredits(virtualBankAccountId?: string): MockInboundCredit[] {
    const credits =
      virtualBankAccountId === undefined
        ? [...this.inboundCredits]
        : this.inboundCredits.filter((c) => c.virtualBankAccountId === virtualBankAccountId);
    // Insertion order IS arrival order, so reversing it is exact. Sorting on
    // `receivedAt` is not: two credits landed in the same millisecond share a
    // timestamp and their relative order becomes implementation-defined, which
    // is a flaky ordering guarantee rather than a stable one.
    return credits.reverse();
  }

  // ── Payouts (contract 1.3.0) ─────────────────────────────────────────
  // Ceremony: register a beneficiary bank account on the PARTY, bind it to an
  // ACCOUNT as a payout route, prove ownership of the funding wallet, then
  // request payouts against the ACTIVE route. Where the contract is silent on
  // transition semantics (who activates a bank account, when a route needs
  // proof), the mock takes the least-opinionated reading and leaves the rest
  // to explicit drivers – documented as MG-14 in the program's mock-gap ledger.

  listPayoutBankAccounts(ctx: HandlerContext): PayoutBankAccount[] {
    this.getParty(ctx);
    return this.payoutBankAccounts.filter((a) => a.partyId === ctx.params.partyId);
  }

  getPayoutBankAccount(ctx: HandlerContext): PayoutBankAccount {
    this.getParty(ctx);
    const found = this.payoutBankAccounts.find(
      (a) => a.id === ctx.params.id && a.partyId === ctx.params.partyId,
    );
    if (!found) {
      notFound(ctx, "payout-bank-account-not-found", `No payout bank account with id ${ctx.params.id}.`);
    }
    return found;
  }

  registerPayoutBankAccount(ctx: HandlerContext): PayoutBankAccount {
    const party = this.getParty(ctx);
    const b = ctx.body as schemas["RegisterPayoutBankAccountRequest"];
    // The response's `details` are MASKED rail details: the mock derives the
    // mask from the submitted rail details rather than echoing them whole.
    const details: schemas["MaskedRailDetailsDto"] = {};
    if (b.railDetails?.iban) details.ibanLast4 = b.railDetails.iban.slice(-4);
    if (b.railDetails?.bic) details.bic = b.railDetails.bic;
    if (b.railDetails?.accountNumber) {
      details.accountNumberLast4 = b.railDetails.accountNumber.slice(-4);
    }
    if (b.railDetails?.abaRoutingNumber) details.abaRoutingNumber = b.railDetails.abaRoutingNumber;
    if (b.railDetails?.accountType) {
      details.accountType = b.railDetails.accountType as schemas["MaskedRailDetailsDto"]["accountType"];
    }
    const bankAccount: PayoutBankAccount = {
      id: this.mintId(),
      partyId: party.id,
      rail: b.rail as PayoutBankAccount["rail"],
      fiatCurrency: b.fiatCurrency,
      label: b.label,
      accountHolderName: b.accountHolderName,
      details,
      bankName: b.bankName,
      beneficiaryEmail: b.beneficiaryEmail,
      beneficiaryPhoneNumber: b.beneficiaryPhoneNumber,
      bankAddress: b.bankAddress,
      // New beneficiary accounts start PENDING; activation is an operator
      // decision the public API does not expose. Driver: advancePayoutBankAccount.
      status: "PENDING",
      createdAt: this.now(),
    };
    this.payoutBankAccounts.push(bankAccount);
    return toResponseShape(
      "POST /parties/{partyId}/payout-bank-accounts",
      bankAccount as Record<string, unknown>,
    ) as PayoutBankAccount;
  }

  listPayoutRoutes(ctx: HandlerContext): PayoutRoute[] {
    this.getAccount(ctx);
    return this.payoutRoutes.get(ctx.params.accountId) ?? [];
  }

  private getPayoutRoute(ctx: HandlerContext, routeId = ctx.params.routeId): PayoutRoute {
    const routes = this.payoutRoutes.get(ctx.params.accountId) ?? [];
    const route = routes.find((r) => r.id === routeId);
    if (!route) notFound(ctx, "payout-route-not-found", `No payout route with id ${routeId}.`);
    return route;
  }

  createPayoutRoute(ctx: HandlerContext): PayoutRoute {
    const account = this.getAccount(ctx);
    const b = ctx.body as schemas["CreatePayoutRouteRequest"];
    const bankAccount = this.payoutBankAccounts.find((a) => a.id === b.payoutBankAccountId);
    if (!bankAccount) {
      badRequest(ctx, `No payout bank account with id ${b.payoutBankAccountId}.`);
    }
    if (bankAccount.status !== "ACTIVE") {
      badRequest(ctx, "The payout bank account must be ACTIVE before a route can use it.");
    }
    const route: PayoutRoute = {
      id: this.mintId(),
      // A fresh route awaits proof that the integrator controls the wallet
      // that will fund it; completeOwnershipProof moves it to ACTIVE.
      status: "AWAITING_OWNERSHIP_PROOF",
      depositAsset: b.depositAsset,
      fiatCurrency: bankAccount.fiatCurrency,
      depositAddress: this.mintAddress(),
      createdAt: this.now(),
    };
    const routes = this.payoutRoutes.get(account.id as string) ?? [];
    routes.push(route);
    this.payoutRoutes.set(account.id as string, routes);
    return toResponseShape(
      "POST /accounts/{accountId}/payout-routes",
      route as Record<string, unknown>,
    ) as PayoutRoute;
  }

  private payoutProofWallets = new Map<string, string>();

  preparePayoutOwnershipProof(ctx: HandlerContext): schemas["PayoutOwnershipProofDto"] {
    this.getAccount(ctx);
    const route = this.getPayoutRoute(ctx);
    // The endpoint takes no body: the server derives the funding wallet and
    // chain from the route. The mock mints one wallet per route and keeps it
    // stable so a repeated prepare returns the same message.
    let walletAddress = this.payoutProofWallets.get(route.id as string);
    if (!walletAddress) {
      walletAddress = this.mintAddress();
      this.payoutProofWallets.set(route.id as string, walletAddress);
    }
    return {
      walletAddress,
      blockchain: route.depositAsset?.chain,
      message: `venly-ownership-proof:${route.id}:${walletAddress}`,
      signedOnUtc: this.now(),
    };
  }

  completePayoutOwnershipProof(ctx: HandlerContext): PayoutRoute {
    this.getAccount(ctx);
    const route = this.getPayoutRoute(ctx);
    if (route.status === "REJECTED") {
      badRequest(ctx, "A REJECTED route cannot be activated.");
    }
    route.status = "ACTIVE";
    route.updatedAt = this.now();
    return route;
  }

  listPayouts(ctx: HandlerContext): Payout[] {
    this.getAccount(ctx);
    const rows = applyQueryFilters(
      this.payouts.filter((p) => p.accountId === ctx.params.accountId) as Record<string, unknown>[],
      ctx.query,
      ["status"],
    ) as Payout[];
    // The list schema carries payoutRoute as PayoutRouteSummaryDto (id,
    // depositAsset, fiatCurrency, status) - no beneficiary, no depositAddress.
    // Those live on the detail (getPayout). Teaching the fat shape in a list
    // would train integrators on fields the real list never returns.
    return rows.map((p) => {
      if (!p.payoutRoute) return p;
      const route = [...this.payoutRoutes.values()]
        .flat()
        .find((r) => r.id === p.payoutRoute?.id);
      return {
        ...p,
        payoutRoute: {
          id: p.payoutRoute.id,
          depositAsset: p.payoutRoute.depositAsset,
          fiatCurrency: p.payoutRoute.fiatCurrency,
          ...(route?.status !== undefined ? { status: route.status } : {}),
        },
      } as Payout;
    });
  }

  getPayout(ctx: HandlerContext): Payout {
    this.getAccount(ctx);
    const payout = this.payouts.find(
      (p) => p.id === ctx.params.payoutId && p.accountId === ctx.params.accountId,
    );
    if (!payout) notFound(ctx, "payout-not-found", `No payout with id ${ctx.params.payoutId}.`);
    return payout;
  }

  requestPayout(ctx: HandlerContext): schemas["IdempotentResponsePayoutDto"] {
    const account = this.getAccount(ctx);
    const b = ctx.body as schemas["CreatePayoutRequest"];
    const intentKey = `${account.id}:${ctx.idempotencyKey ?? b.idempotencyKey}`;
    const fingerprint = requestFingerprint(b);
    const existing = this.payoutIntents.get(intentKey);
    if (existing) {
      if (existing.outcome === "failed" || existing.fingerprint !== fingerprint || !existing.result) {
        idempotencyConflict(ctx);
      }
      return toResponseShape("POST /accounts/{accountId}/payouts", {
        createdResourceId: existing.result.id,
        response: existing.result,
      } as Record<string, unknown>) as schemas["IdempotentResponsePayoutDto"];
    }
    if (account.status !== "ACTIVE" || account.kycStatus !== "VERIFIED") {
      this.payoutIntents.set(intentKey, { fingerprint, outcome: "failed" });
      badRequest(ctx, "Payouts require an active, verified account.");
    }
    const routes = this.payoutRoutes.get(account.id as string) ?? [];
    const route = routes.find((r) => r.id === b.payoutRouteId);
    if (!route) {
      this.payoutIntents.set(intentKey, { fingerprint, outcome: "failed" });
      badRequest(ctx, `No payout route with id ${b.payoutRouteId} on this account.`);
    }
    if (route.status !== "ACTIVE") {
      this.payoutIntents.set(intentKey, { fingerprint, outcome: "failed" });
      badRequest(ctx, `Payouts require an ACTIVE route; ${route.id} is ${route.status}.`);
    }
    if (!(b.cryptoAmount > 0)) {
      this.payoutIntents.set(intentKey, { fingerprint, outcome: "failed" });
      badRequest(ctx, "cryptoAmount must be a positive number.");
    }
    const bankAccount = this.payoutBankAccounts.find(
      (a) => a.fiatCurrency === route.fiatCurrency && a.status === "ACTIVE",
    );
    const payout: Payout = {
      id: this.mintId(),
      accountId: account.id,
      payoutRoute: {
        id: route.id,
        depositAsset: route.depositAsset,
        fiatCurrency: route.fiatCurrency,
        depositAddress: route.depositAddress,
        beneficiary: bankAccount && {
          id: bankAccount.id,
          partyId: bankAccount.partyId,
          rail: bankAccount.rail,
          label: bankAccount.label,
          accountHolderName: bankAccount.accountHolderName,
          bankName: bankAccount.bankName,
          details: bankAccount.details,
        },
      },
      rail: bankAccount?.rail,
      cryptoAmount: b.cryptoAmount,
      // The account's Venly-managed wallet funds the payout unless the
      // integrator pushes to the route's deposit address themselves.
      fundingMode: "PULL",
      status: "REQUESTED",
      requestedAt: this.now(),
    };
    // PULL payouts are funded from the account's Venly-managed wallet, so the
    // amount is reserved now and leaves `total` at SENDING. A PUSH payout is
    // funded off-SDK to the deposit address and never touches the wallet.
    if (payout.fundingMode === "PULL") {
      const asset = route.depositAsset?.name;
      if (!asset) {
        this.payoutIntents.set(intentKey, { fingerprint, outcome: "failed" });
        badRequest(ctx, `Payout route ${route.id} declares no deposit asset.`);
      }
      try {
        this.ledger.movePhase(
          payout.id as string,
          "HELD",
          { accountId: account.id as string, asset, amount: b.cryptoAmount },
          `payout ${payout.id}`,
        );
      } catch (error) {
        this.payoutIntents.set(intentKey, { fingerprint, outcome: "failed" });
        if (error instanceof MockLedgerError) insufficientFunds(ctx, error.message);
        throw error;
      }
    }
    this.payouts.push(payout);
    this.payoutIntents.set(intentKey, { fingerprint, outcome: "succeeded", result: payout });
    this.emit({
      type: "payout.requested",
      resource: { kind: "payout", id: payout.id as string },
      accountId: account.id as string,
      data: payout,
    });
    if (payout.fundingMode === "PULL" && route.depositAsset?.name) {
      this.emitBalance(account.id as string, route.depositAsset.name);
    }
    return toResponseShape("POST /accounts/{accountId}/payouts", {
      createdResourceId: payout.id,
      response: payout,
    } as Record<string, unknown>) as schemas["IdempotentResponsePayoutDto"];
  }

  /**
   * Walk a payout to any documented status. COMPLETED stamps completedAt, a
   * send hash and – stablecoin par unless overridden – settledFiatAmount;
   * REJECTED/FAILED/RETURNED stamp a failureReason. The override arguments
   * are the integrator's seam, same doctrine as simulateInboundCredit.
   */
  advancePayout(
    id: string,
    to: NonNullable<Payout["status"]>,
    opts?: { settledFiatAmount?: number; failureReason?: string; sendTxHash?: string },
  ): Payout {
    const payout = this.payouts.find((p) => p.id === id);
    if (!payout) {
      throw new Error(`advancePayout: no payout with id ${id} in the mock store.`);
    }
    const previous = payout.status;
    const asset = payout.payoutRoute?.depositAsset?.name;
    if (payout.fundingMode === "PULL" && asset) {
      this.ledger.movePhase(
        id,
        PAYOUT_PHASE[to],
        {
          accountId: payout.accountId as string,
          asset,
          amount: payout.cryptoAmount as number,
        },
        `payout ${id}`,
      );
    }
    payout.status = to;
    if (to === "SENDING" || to === "PROVIDER_PROCESSING" || to === "COMPLETED") {
      payout.sendTxHash = opts?.sendTxHash ?? payout.sendTxHash ?? this.mintHash();
    }
    if (to === "COMPLETED") {
      payout.completedAt = this.now();
      payout.settledFiatAmount = opts?.settledFiatAmount ?? payout.cryptoAmount;
    }
    if (to === "REJECTED" || to === "FAILED" || to === "RETURNED") {
      payout.failureReason =
        opts?.failureReason ??
        payout.failureReason ??
        (to === "RETURNED"
          ? "Returned by the receiving bank"
          : "Rejected by the payout provider");
    }
    this.emit({
      type: "payout.status_changed",
      resource: { kind: "payout", id },
      accountId: payout.accountId as string,
      previous: { status: previous },
      data: payout,
    });
    if (payout.fundingMode === "PULL" && asset) {
      this.emitBalance(payout.accountId as string, asset);
    }
    return payout;
  }

  /** Activate (or disable) a beneficiary bank account – an operator action. */
  advancePayoutBankAccount(
    id: string,
    to: NonNullable<PayoutBankAccount["status"]> = "ACTIVE",
  ): PayoutBankAccount {
    const bankAccount = this.payoutBankAccounts.find((a) => a.id === id);
    if (!bankAccount) {
      throw new Error(`advancePayoutBankAccount: no payout bank account with id ${id} in the mock store.`);
    }
    bankAccount.status = to;
    bankAccount.updatedAt = this.now();
    return bankAccount;
  }

  /** Walk a payout route to any documented status (e.g. simulate REJECTED). */
  advancePayoutRoute(id: string, to: NonNullable<PayoutRoute["status"]>): PayoutRoute {
    for (const routes of this.payoutRoutes.values()) {
      const route = routes.find((r) => r.id === id);
      if (route) {
        route.status = to;
        route.updatedAt = this.now();
        return route;
      }
    }
    throw new Error(`advancePayoutRoute: no payout route with id ${id} in the mock store.`);
  }
}

import type { components } from "../generated/finance.js";
import { financeResponseShapes } from "../generated/finance-shapes.js";
import { mockError, type HandlerContext } from "./transport.js";

type schemas = components["schemas"];
type Party = schemas["PartyDto"];
type Account = schemas["AccountListItemDto"];
type Wallet = schemas["WalletBalanceDto"];
type PartyRole = schemas["PartyRoleDto"];
type VirtualBankAccount = schemas["VirtualBankAccountResponse"];
type Transfer = schemas["TransferRequestDto"];
type PaymentSession = schemas["PayInSessionDto"];

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
}

export type VerificationStatusInput =
  | "VERIFICATION_PENDING"
  | "PENDING"
  | "VERIFIED"
  | "REJECTED"
  | "DENIED";

function now(): string {
  return new Date().toISOString();
}

function mintAddress(): string {
  return "0x" + crypto.randomUUID().replace(/-/g, "").slice(0, 40);
}

function mintHash(): string {
  return (
    "0x" +
    (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, "").slice(0, 64)
  );
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
  private virtualBankAccountIntents = new Map<string, {
    fingerprint: string;
    outcome: "failed" | "succeeded";
    result?: VirtualBankAccount;
  }>();

  private counter = 0;
  private readonly seeds: FinanceSeeds;

  constructor(seeds: FinanceSeeds) {
    this.seeds = seeds;
    this.reset();
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
    this.virtualBankAccountIntents.clear();
    this.counter = 0;
  }

  private mintId(): string {
    this.counter += 1;
    return crypto.randomUUID();
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
        createdAt: now(),
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
        createdAt: now(),
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
    party.updatedAt = now();
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
      createdAt: now(),
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
      createdAt: now(),
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

  createFiatTransfer(ctx: HandlerContext): Transfer {
    const sender = this.getAccount(ctx, ctx.params.senderAccountId);
    const b = ctx.body as schemas["CreateFiatTransferInput"];
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
      createdAt: now(),
    };
    this.transfers.push(transfer);
    return toResponseShape(
      "POST /accounts/{senderAccountId}/transfers/fiat",
      transfer as Record<string, unknown>,
    ) as Transfer;
  }

  createCryptoTransfer(ctx: HandlerContext): Transfer {
    const sender = this.getAccount(ctx, ctx.params.senderAccountId);
    const b = ctx.body as schemas["CreateCryptoTransferInput"];
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
      createdAt: now(),
    };
    this.transfers.push(transfer);
    return toResponseShape(
      "POST /accounts/{senderAccountId}/transfers/crypto",
      transfer as Record<string, unknown>,
    ) as Transfer;
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
      party.updatedAt = now();
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
    transfer.status = status;
    if (status === "COMPLETED") transfer.transactionHash = mintHash();
    if (status === "FAILED") {
      transfer.errorMessage = transfer.errorMessage ?? "Insufficient available balance";
    }
    transfer.updatedAt = now();
  }

  createPaymentSession(ctx: HandlerContext): PaymentSession {
    const b = ctx.body as schemas["CreatePayInSessionInput"];
    const id = this.mintId();
    const session: PaymentSession = {
      id,
      createdAt: now(),
      updatedAt: now(),
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
    session.updatedAt = now();
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
    const credit: MockInboundCredit = {
      id: this.mintId(),
      virtualBankAccountId,
      referenceCode:
        referenceCode === undefined ? (vba.referenceCode ?? null) : referenceCode,
      amount,
      currency: vba.currency,
      receivedAt: now(),
    };
    this.inboundCredits.push(credit);
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
}

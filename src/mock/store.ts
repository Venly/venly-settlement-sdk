import type { components } from "../generated/finance.js";
import { financeResponseShapes } from "../generated/finance-shapes.js";
import { exchangeRates } from "./fundflow.js";
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
type Webhook = schemas["WebhookDto"];
type WebhookAuthenticationMethod = NonNullable<Webhook["authenticationMethod"]>;

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

/**
 * One simulated delivery of a mock event to a registered webhook. No
 * delivery-log operation exists on any plane of the published contract:
 * this is a SIMULATION record - the mock's event runtime noting that, had
 * these webhooks been real endpoints, the platform would have delivered
 * this event to them. It renders only inside simulator chrome, badged as
 * simulation, and must never be surfaced as if an API operation served it.
 * `status` is mock vocabulary (the simulated delivery always lands; the
 * mock models no failing endpoint), not a contract enum.
 */
export interface MockWebhookDelivery {
  webhookId: string;
  eventType: string;
  at: string;
  status: "DELIVERED";
}

/** Retained per store, oldest dropped first - mirrors the event buffer. */
const WEBHOOK_DELIVERY_BUFFER = 500;

/** The record classes an agent-prepared decision draft can attach to. */
export type MockDecisionRecordType = "verification" | "reconciliation" | "payout_exception";

/** What a caller supplies to prepare a decision draft. */
export interface MockDecisionDraftInput {
  recordType: MockDecisionRecordType;
  /** verification: a party or account id · reconciliation: an inbound credit id · payout_exception: a payout id. */
  recordId: string;
  /** The decision the agent proposes, in operator language. */
  proposal: string;
  /** Why - citing the evidence the agent read. */
  reason: string;
  /** References into that evidence (field paths, event ids, record ids). */
  evidenceRefs?: string[];
}

/**
 * An agent-prepared decision draft attached to a record. MOCK-ONLY concept:
 * no operation on either public plane stores or serves a decision draft -
 * this exists so the maker/checker split is demonstrable (an agent PREPARES,
 * a human decides through the existing ceremony). A draft never auto-applies
 * anything; the only transitions are PREPARED at creation and SUPERSEDED when
 * a human decision lands on the record (or a driver marks it directly). Any
 * surface rendering one must badge it as a sandbox agent draft, never as API
 * state.
 */
export interface MockDecisionDraft extends Required<Omit<MockDecisionDraftInput, "evidenceRefs">> {
  id: string;
  evidenceRefs: string[];
  preparedAt: string;
  status: "PREPARED" | "SUPERSEDED";
  supersededAt?: string;
}

/**
 * Management-plane twin fields on the mock's payout row.
 *
 * The management reconciliation read computes these per payout, and the
 * management decision operations accept the note fields - the finance plane
 * carries none of them. They live on the mock row so an operator surface can
 * render the second axis and so decision notes survive the ceremony, while
 * the finance routes project the row down to the contract shape - the public
 * plane never serves a field its schema does not declare.
 *
 * Field names and enums mirror the management contract verbatim; nothing here
 * is invented. That includes the provider vocabulary: `providerType`'s
 * members and the `dakotaOfframpTxId` field name are the management plane's
 * own identifiers for its payout rails, reproduced as-is. Every provider
 * value in mock data is simulated and asserts nothing about any live
 * integration. `reconciliationState` is computed by the management plane in
 * production; the mock stores only what a driver explicitly asserts and never
 * defaults it.
 */
export interface MockPayoutManagementTwin {
  reconciliationState?: "MATCHED" | "IN_PROGRESS" | "STUCK" | "MISMATCH" | "NEEDS_REVIEW";
  providerType?: "IRON" | "DAKOTA";
  providerPayoutId?: string;
  providerReference?: string;
  sourceWalletAddress?: string;
  minutesInProviderProcessing?: number;
  note?: string;
  fiatReference?: string;
  dakotaOfframpTxId?: string;
}

/** The payout row as the mock stores it: contract shape plus the twin. */
export type MockPayoutRow = Payout & MockPayoutManagementTwin;

/**
 * The keys `PayoutDto` declares. Finance-plane payout reads project the mock
 * row through this list so the twin fields above never leak onto the public
 * plane. Kept in step with the generated schema by the payout tests.
 */
const PAYOUT_WIRE_KEYS = [
  "id",
  "accountId",
  "payoutRoute",
  "rail",
  "cryptoAmount",
  "settledFiatAmount",
  "fundingMode",
  "status",
  "sendTxHash",
  "requestedAt",
  "completedAt",
  "failureReason",
] as const;

function toPayoutWire(row: MockPayoutRow): Payout {
  const out: Record<string, unknown> = {};
  for (const key of PAYOUT_WIRE_KEYS) {
    const value = (row as Record<string, unknown>)[key];
    if (value !== undefined) out[key] = value;
  }
  return out as Payout;
}

/** Seed data the store starts from (and returns to on `reset()`). */
export interface FinanceSeeds {
  parties: Party[];
  accounts: Account[];
  /** Wallets per account id. Accounts absent here have no wallet yet. */
  wallets: Record<string, Wallet[]>;
  /** Fallback role applied to every account that `rolesByAccount` does not cover. */
  partyRole: PartyRole;
  /**
   * Per-account roles. Without these every account shares one holder, so a
   * profile's "denied applicant" account would read as held by a verified
   * party - a join the fixtures assert and the story contradicts.
   */
  rolesByAccount?: Record<string, PartyRole[]>;
  virtualBankAccounts: VirtualBankAccount[];
  transfers: Transfer[];
  /** Beneficiary bank accounts per party (flat; each row carries partyId). */
  payoutBankAccounts: PayoutBankAccount[];
  /** Payout routes per account id (routes carry no accountId on the wire). */
  payoutRoutes: Record<string, PayoutRoute[]>;
  /**
   * Which beneficiary bank account each seeded route was created against
   * (route id -> payout bank account id). The wire carries no such key, but
   * the store must know it: a payout embeds its route's beneficiary, and
   * serving any other account there teaches a wrong join. Routes created at
   * runtime record the pairing from their create request; seeded routes
   * need it declared. An unmapped route yields NO embedded beneficiary -
   * honest absence, never a guess.
   */
  routeBankAccounts?: Record<string, string>;
  payouts: MockPayoutRow[];
  /** Tenant-wide supported assets; `decimals` must be each asset's real on-chain value. */
  supportedAssets: SupportedAsset[];
  /** Account-scoped rows (adds permitStatus) per account id. */
  accountSupportedAssets: Record<string, AccountSupportedAsset[]>;
  /** Party IV verifications. A party with no row reads as NOT_LINKED. */
  ivVerifications?: schemas["PartyIvVerificationDto"][];
  /**
   * Registered webhooks. Seeded `authenticationMethod` secret fields must
   * already be masked values - a seed carrying a plausible plaintext secret
   * would teach that the API echoes secrets, which it never does.
   */
  webhooks?: Webhook[];
}

/** Contract status -> what the money did. */
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

/**
 * Map a ledger failure onto the status and code its cause deserves.
 *
 * `402 insufficient-funds` means exactly one thing: the account does not hold
 * enough. A client branching on 402 shows a top-up screen, so an over-precise
 * amount or a mistyped asset symbol must not land there — those are `400`, with
 * their own codes so a handler can tell them apart without reading the message.
 */
function ledgerError(ctx: HandlerContext, error: MockLedgerError): never {
  if (error.kind === "insufficient-funds") {
    mockError(
      { status: 402, code: "insufficient-funds", message: error.message },
      ctx.method,
      ctx.path,
    );
  }
  // Each 400 gets its own code, because each wants a different client response:
  // reformat the amount, correct the asset symbol, or flag the form field. An
  // `invariant` failure is none of those - reporting it as an amount problem
  // would be the same wrong-cause-to-the-client defect this mapping exists to
  // fix - so it keeps the generic code.
  const code =
    error.kind === "unsupported-asset"
      ? "unsupported-asset"
      : error.kind === "invalid-amount"
        ? "invalid-amount"
        : "invalid-request";
  mockError({ status: 400, code, message: error.message }, ctx.method, ctx.path);
}

/**
 * Amounts are validated before anything is minted, so a refusal never quotes
 * the id of a resource that was not created — an id in an error message is an
 * invitation to look it up, and that one would 404.
 */
function assertPositiveAmount(ctx: HandlerContext, amount: number | undefined, field: string): void {
  if (!(typeof amount === "number" && amount > 0)) {
    mockError(
      {
        status: 400,
        code: "invalid-amount",
        message:
          `${field} must be greater than zero, got ${amount}. Direction is decided by the ` +
          `operation — a negative amount would move money backwards, taking it from the ` +
          `counterparty instead of sending it.`,
      },
      ctx.method,
      ctx.path,
    );
  }
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
      message:
        "This idempotency key was already used for a different request body, or for an " +
        "attempt that failed. A failed attempt is never retried under the same key - issue a " +
        "new idempotency key for a fresh attempt.",
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
  /** route id -> the payout bank account it was created against. */
  routeBankAccounts = new Map<string, string>();
  payouts: MockPayoutRow[] = [];
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

  webhooks: Webhook[] = [];
  /** Simulated deliveries, oldest first. See MockWebhookDelivery. */
  webhookDeliveries: MockWebhookDelivery[] = [];
  /** Agent-prepared decision drafts (mock-only; see MockDecisionDraft). */
  decisionDrafts: MockDecisionDraft[] = [];

  private counter = 0;
  private initialised = false;
  private seeds: FinanceSeeds;
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
    const event = this.events.emit(input);
    this.recordWebhookDeliveries(event.type, event.occurredAt);
  }

  /**
   * The delivery-recording seam: every business event minted by this store
   * passes through `emit()` above, so one hook covers every driver and every
   * request-path mutation - a new route cannot forget to deliver. `store.*`
   * events are replication plumbing, not business events the platform would
   * deliver to an integrator endpoint, so they are excluded. Deliveries are
   * store state, so peers adopt them through the same snapshots that carry
   * every other row.
   */
  private recordWebhookDeliveries(eventType: string, at: string): void {
    if (eventType.startsWith("store.")) return;
    // decision.* events are a mock-only vocabulary (no contract op models a
    // decision draft), so recording a delivery would teach that the real
    // platform webhooks them. It does not; they stay out of the simulated log.
    if (eventType.startsWith("decision.")) return;
    for (const webhook of this.webhooks) {
      if (webhook.status !== "ACTIVE" || !webhook.id) continue;
      this.webhookDeliveries.push({ webhookId: webhook.id, eventType, at, status: "DELIVERED" });
    }
    if (this.webhookDeliveries.length > WEBHOOK_DELIVERY_BUFFER) {
      this.webhookDeliveries.splice(0, this.webhookDeliveries.length - WEBHOOK_DELIVERY_BUFFER);
    }
  }

  /** Restore the seed fixtures, discarding everything created since. */
  reset(): void {
    if (this.initialised) {
      // store.reset is the LAST event of the outgoing epoch; the epoch then
      // rolls and sequence restarts at 1, so ids stay unique across resets
      // while a deterministic replay still compares within one epoch.
      this.emit({ type: "store.reset", resource: { kind: "store", id: "store" }, data: {} });
      this.events.rollEpoch(this.events.epoch + 1);
    }
    // Rewind first: a replay that mints different ids is not a replay, and the
    // seeds themselves are stamped from this clock.
    this.clock.reset?.();
    this.ids.reset?.();
    const s = structuredClone(this.seeds);
    this.parties = s.parties;
    this.accounts = s.accounts;
    this.wallets = new Map(Object.entries(s.wallets));
    this.rolesByAccount = new Map(
      s.accounts.map((a) => [
        a.id as string,
        s.rolesByAccount?.[a.id as string] ?? [{ ...s.partyRole }],
      ]),
    );
    this.virtualBankAccounts = s.virtualBankAccounts;
    this.transfers = s.transfers;
    this.paymentSessions = [];
    this.inboundCredits = [];
    this.payoutBankAccounts = s.payoutBankAccounts;
    this.payoutRoutes = new Map(Object.entries(s.payoutRoutes));
    this.routeBankAccounts = new Map(Object.entries(s.routeBankAccounts ?? {}));
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
    this.webhooks = s.webhooks ?? [];
    this.webhookDeliveries = [];
    // The seeds carry no drafts: reset() returns to a world where no agent
    // has prepared anything yet.
    this.decisionDrafts = [];
    this.ledger.reset();
    this.hydrateLedger();
    this.initialised = true;
    // A seed that cannot satisfy the invariants is a fixture teaching a
    // falsehood, and it fails here rather than halfway through a demo.
    this.ledger.verify();
  }

  /**
   * Seeded balances are the *post* state, so hydration records each seeded
   * money object at the phase its status implies and posts no delta. The
   * reserve check then confirms that every reserved amount has a pending
   * operation behind it.
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

  /**
   * Everything a peer needs to reproduce this store's world. Ledger holds are
   * rebuilt by re-hydrating from the restored rows rather than shipped, so the
   * snapshot stays plain JSON.
   */
  snapshotState(): Record<string, unknown> {
    return structuredClone({
      parties: this.parties,
      accounts: this.accounts,
      wallets: Object.fromEntries(this.wallets),
      rolesByAccount: Object.fromEntries(this.rolesByAccount),
      virtualBankAccounts: this.virtualBankAccounts,
      transfers: this.transfers,
      paymentSessions: this.paymentSessions,
      inboundCredits: this.inboundCredits,
      payoutBankAccounts: this.payoutBankAccounts,
      payoutRoutes: Object.fromEntries(this.payoutRoutes),
      routeBankAccounts: Object.fromEntries(this.routeBankAccounts),
      payouts: this.payouts,
      supportedAssets: this.supportedAssets,
      accountSupportedAssets: Object.fromEntries(this.accountSupportedAssets),
      ivVerifications: [...this.ivVerifications.values()],
      webhooks: this.webhooks,
      webhookDeliveries: this.webhookDeliveries,
      decisionDrafts: this.decisionDrafts,
      // The rendered wallet rows above cannot carry an 18-decimal balance, so
      // the authoritative minor-unit amounts travel alongside them. Without
      // this a peer rebuilds its ledger from the lossy view and the two
      // replicas silently disagree about a balance while both verify() green.
      ledgerBalances: this.ledger.exportBalances(),
    });
  }

  restoreState(state: Record<string, unknown>): void {
    const s = structuredClone(state) as Record<string, never>;
    this.parties = s.parties;
    this.accounts = s.accounts;
    this.wallets = new Map(Object.entries(s.wallets ?? {}));
    this.rolesByAccount = new Map(Object.entries(s.rolesByAccount ?? {}));
    this.virtualBankAccounts = s.virtualBankAccounts;
    this.transfers = s.transfers;
    this.paymentSessions = s.paymentSessions;
    this.inboundCredits = s.inboundCredits;
    this.payoutBankAccounts = s.payoutBankAccounts;
    this.payoutRoutes = new Map(Object.entries(s.payoutRoutes ?? {}));
    this.routeBankAccounts = new Map(Object.entries(s.routeBankAccounts ?? {}));
    this.payouts = s.payouts;
    this.supportedAssets = s.supportedAssets;
    this.accountSupportedAssets = new Map(Object.entries(s.accountSupportedAssets ?? {}));
    this.ivVerifications = new Map(
      ((s.ivVerifications ?? []) as schemas["PartyIvVerificationDto"][]).map(
        (iv) => [iv.partyId as string, iv] as const,
      ),
    );
    this.webhooks = (s.webhooks ?? []) as Webhook[];
    this.webhookDeliveries = (s.webhookDeliveries ?? []) as MockWebhookDelivery[];
    this.decisionDrafts = (s.decisionDrafts ?? []) as MockDecisionDraft[];
    // Adopted state is a post-state, exactly like seeds, so holds are
    // re-derived at their implied phase and post no delta.
    this.ledger.reset();
    const balances = (state as { ledgerBalances?: Record<string, { total: string; available: string; reserved: string }> })
      .ledgerBalances;
    if (balances) this.ledger.adoptBalances(balances);
    this.hydrateLedger();
  }

  /**
   * Load a cast over the seeds, then check every balance rule.
   *
   * Each top-level key REPLACES the seeded one wholesale rather than merging,
   * so a profile that supplies `wallets` must also supply the `transfers` and
   * `payouts` that reserve against them. Replacing balances while keeping the
   * seeded pending operations leaves reserves with nothing behind them, and the
   * check will refuse the profile.
   */
  applyProfile(profile: Partial<FinanceSeeds>): void {
    // Transactional: the check that refuses a bad profile must not install it.
    // Assigning first and validating inside reset() left the poisoned seeds in
    // place when the check fired, so the store served the bad fixture over the
    // public wallets read and every later reset() threw on the same seed - the
    // refusal bricked the mock instead of protecting it.
    const previous = this.seeds;
    this.seeds = { ...this.seeds, ...structuredClone(profile) };
    try {
      this.reset();
    } catch (error) {
      this.seeds = previous;
      this.reset();
      throw error;
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

  // ── Webhooks ─────────────────────────────────────────────────────────
  //
  // Full public-plane lifecycle: GET/POST /webhooks, GET/PUT/DELETE
  // /webhooks/{webhookId}, POST /webhooks/{webhookId}/ping. Two contract
  // facts shape this twin:
  //  - `createWebhook` carries NO idempotency envelope - no body field, no
  //    header parameter - unlike transfers. A replayed create mints a second
  //    webhook, and the tests assert that ABSENCE. Any retry-safety a client
  //    adds on top is a client-side convention, never contract-real.
  //  - `apiKey` and `password` are writeOnly in the contract, and the real
  //    platform never echoes a stored secret. The mock stores MASKED values
  //    (never the plaintext), so nothing it later serves can leak one.

  /** "abcd-secret-1234" -> "••••1234"; short values mask fully. */
  private maskSecret(value: string): string {
    return value.length > 4 ? `••••${value.slice(-4)}` : "••••";
  }

  /**
   * Validates the oneOf and masks the writeOnly secret before anything is
   * stored. Discriminator note, verified against the contract: the base
   * schema's `type` enum says `API_KEY · BASIC_AUTHENTICATION` while the
   * discriminator carries no explicit mapping, so the generated types use
   * the variant schema names as the literals. The mock accepts BOTH
   * spellings on input and always serves the generated literals, so a
   * client typed against the generated request shapes round-trips exactly.
   */
  private maskAuthenticationMethod(
    ctx: HandlerContext,
    input: unknown,
  ): WebhookAuthenticationMethod {
    const method = input as Record<string, unknown> | undefined;
    const type = method?.type;
    if (type === "ApiKeyAuthenticationMethod" || type === "API_KEY") {
      if (typeof method?.headerName !== "string" || typeof method?.apiKey !== "string") {
        badRequest(ctx, 'API-key authentication requires "headerName" and "apiKey".');
      }
      return {
        type: "ApiKeyAuthenticationMethod",
        headerName: method.headerName,
        apiKey: this.maskSecret(method.apiKey),
      };
    }
    if (type === "BasicAuthenticationMethod" || type === "BASIC_AUTHENTICATION") {
      if (typeof method?.username !== "string" || typeof method?.password !== "string") {
        badRequest(ctx, 'Basic authentication requires "username" and "password".');
      }
      return {
        type: "BasicAuthenticationMethod",
        username: method.username,
        password: this.maskSecret(method.password),
      };
    }
    badRequest(
      ctx,
      `Unknown authenticationMethod type "${String(type)}". ` +
        "Use ApiKeyAuthenticationMethod or BasicAuthenticationMethod.",
    );
  }

  private assertWebhookUrl(ctx: HandlerContext, url: unknown): asserts url is string {
    if (typeof url !== "string" || !/^https:\/\/.+/.test(url)) {
      badRequest(ctx, '"url" must be an https:// URL.');
    }
  }

  listWebhooks(): Webhook[] {
    return this.webhooks;
  }

  createWebhook(ctx: HandlerContext): Webhook {
    const b = ctx.body as schemas["CreateWebhookRequest"];
    this.assertWebhookUrl(ctx, b.url);
    const webhook: Webhook = {
      id: this.mintId(),
      url: b.url,
      name: b.name,
      authenticationMethod: this.maskAuthenticationMethod(ctx, b.authenticationMethod),
      // The contract's status enum has a single member.
      status: "ACTIVE",
    };
    // Deliberately NO intent map here (compare transfers/payouts): the
    // contract gives this create no idempotency semantics, so a replay is
    // a second webhook. The webhook tests prove it.
    this.webhooks.push(webhook);
    return webhook;
  }

  getWebhook(ctx: HandlerContext): Webhook {
    const webhook = this.webhooks.find((w) => w.id === ctx.params.webhookId);
    if (!webhook) notFound(ctx, "webhook-not-found", `No webhook with id ${ctx.params.webhookId}.`);
    return webhook;
  }

  updateWebhook(ctx: HandlerContext): Webhook {
    const webhook = this.getWebhook(ctx);
    const b = ctx.body as schemas["UpdateWebhookRequest"];
    this.assertWebhookUrl(ctx, b.url);
    webhook.url = b.url;
    if (b.name !== undefined) webhook.name = b.name;
    webhook.authenticationMethod = this.maskAuthenticationMethod(ctx, b.authenticationMethod);
    return webhook;
  }

  deleteWebhook(ctx: HandlerContext): undefined {
    const idx = this.webhooks.findIndex((w) => w.id === ctx.params.webhookId);
    if (idx === -1) {
      notFound(ctx, "webhook-not-found", `No webhook with id ${ctx.params.webhookId}.`);
    }
    this.webhooks.splice(idx, 1);
    return undefined;
  }

  /** The contract's ping result is a void envelope; the mock's always lands. */
  pingWebhook(ctx: HandlerContext): schemas["ResponseEnvelopeVoid"] {
    this.getWebhook(ctx);
    return { success: true };
  }

  /** Mock-only read behind the simulator's delivery log. Never API surface. */
  listWebhookDeliveries(webhookId?: string): MockWebhookDelivery[] {
    const rows = webhookId
      ? this.webhookDeliveries.filter((d) => d.webhookId === webhookId)
      : this.webhookDeliveries;
    return [...rows].reverse();
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

  /**
   * `GET /parties/{partyId}/iv-verification`. A party the seeds never linked
   * reads as NOT_LINKED rather than 404: the contract models identity
   * verification as a state every party has, not a resource some parties lack.
   */
  getIvVerification(ctx: HandlerContext): schemas["PartyIvVerificationDto"] {
    const party = this.getParty(ctx);
    return (
      this.ivVerifications.get(party.id as string) ?? {
        partyId: party.id,
        status: "NOT_LINKED",
      }
    );
  }

  /** Mock-only driver: walk a party's IV case to any documented status. */
  advanceIvVerification(
    partyId: string,
    to: NonNullable<schemas["PartyIvVerificationDto"]["status"]>,
  ): schemas["PartyIvVerificationDto"] {
    const party = this.parties.find((p) => p.id === partyId);
    if (!party) {
      throw new Error(`advanceIvVerification: no party with id ${partyId} in the mock store.`);
    }
    const current = this.ivVerifications.get(partyId);
    const previous = current?.status;
    const next: schemas["PartyIvVerificationDto"] = {
      ...current,
      partyId,
      status: to,
      ivCaseReference: current?.ivCaseReference ?? `IV-${partyId.slice(0, 8).toUpperCase()}`,
      linkedAt: current?.linkedAt ?? (to === "NOT_LINKED" ? undefined : this.now()),
    };
    this.ivVerifications.set(partyId, next);
    this.emit({
      type: "party.iv_status_changed",
      resource: { kind: "party", id: partyId },
      previous: { status: previous },
      data: next,
    });
    return next;
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
   * Same key + same body replays the original transfer; same key + a different
   * body is a 409; an attempt that failed stays failed under that key, so a
   * retry needs a fresh one.
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
      // The intent is recorded as failed BEFORE the throw: replaying a request
      // that failed must conflict, not silently retry into a second attempt.
      const key = ctx.idempotencyKey ?? (ctx.body as { idempotencyKey?: string })?.idempotencyKey;
      if (key !== undefined) {
        this.transferIntents.set(`${sender}:${key}`, {
          fingerprint: requestFingerprint(ctx.body),
          outcome: "failed",
        });
      }
      if (error instanceof MockLedgerError) ledgerError(ctx, error);
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
    assertPositiveAmount(ctx, b.amount, "amount");
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
    assertPositiveAmount(ctx, b.amount, "amount");
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
      const previousStatus = party.partyType === "ORGANISATION" ? party.kybStatus : party.kycStatus;
      if (party.partyType === "ORGANISATION") {
        party.kybStatus = (status === "REJECTED" ? "DENIED" : status) as Party["kybStatus"];
      } else {
        party.kycStatus = (status === "PENDING"
          ? "VERIFICATION_PENDING"
          : status) as Party["kycStatus"];
      }
      party.updatedAt = this.now();
      this.emit({
        type: "party.verification_changed",
        resource: { kind: "party", id },
        previous: { status: previousStatus },
        data: party,
      });
      // A human decision landed on this record: any agent draft attached to
      // it is now superseded (contract state - the trail shows the operator).
      this.supersedeDecisionDrafts("verification", id);
      return;
    }
    const account = this.accounts.find((a) => a.id === id);
    if (account) {
      const previousAccountStatus = account.kycStatus;
      account.kycStatus = (status === "PENDING"
        ? "VERIFICATION_PENDING"
        : status) as Account["kycStatus"];
      account.version = (account.version ?? 0) + 1;
      this.emit({
        type: "account.verification_changed",
        resource: { kind: "account", id },
        accountId: id,
        previous: { status: previousAccountStatus },
        data: account,
      });
      this.supersedeDecisionDrafts("verification", id);
      return;
    }
    throw new Error(`advanceVerification: no party or account with id ${id} in the mock store.`);
  }

  // ── Decision drafts (mock-only; see MockDecisionDraft) ────────────────

  /**
   * Store an agent-prepared decision draft against a record and emit
   * `decision.prepared` through the standard path. Validates that the record
   * exists for the given type - a draft on nothing would be a taught
   * falsehood. Drafts never auto-apply anything: the ONLY mutations remain
   * the existing decision ceremonies, and a later human decision on the
   * record marks the draft superseded.
   */
  prepareDecision(input: MockDecisionDraftInput): MockDecisionDraft {
    const { recordType, recordId } = input;
    let accountId: string | undefined;
    if (recordType === "verification") {
      const party = this.parties.find((p) => p.id === recordId);
      const account = this.accounts.find((a) => a.id === recordId);
      if (!party && !account) {
        throw new Error(
          `prepareDecision: no party or account with id ${recordId} in the mock store.`,
        );
      }
      accountId = account ? recordId : undefined;
    } else if (recordType === "reconciliation") {
      const credit = this.inboundCredits.find((c) => c.id === recordId);
      if (!credit) {
        throw new Error(`prepareDecision: no inbound credit with id ${recordId} in the mock store.`);
      }
      accountId = this.virtualBankAccounts.find(
        (vba) => vba.id === credit.virtualBankAccountId,
      )?.accountId;
    } else if (recordType === "payout_exception") {
      const payout = this.payouts.find((p) => p.id === recordId);
      if (!payout) {
        throw new Error(`prepareDecision: no payout with id ${recordId} in the mock store.`);
      }
      accountId = payout.accountId;
    } else {
      throw new Error(
        `prepareDecision: unknown recordType ${JSON.stringify(recordType)} - expected verification, reconciliation or payout_exception.`,
      );
    }
    if (!input.proposal?.trim()) throw new Error("prepareDecision: proposal is required.");
    if (!input.reason?.trim()) throw new Error("prepareDecision: reason is required.");
    const draft: MockDecisionDraft = {
      id: this.mintId(),
      recordType,
      recordId,
      proposal: input.proposal,
      reason: input.reason,
      evidenceRefs: [...(input.evidenceRefs ?? [])],
      preparedAt: this.now(),
      status: "PREPARED",
    };
    this.decisionDrafts.push(draft);
    this.emit({
      type: "decision.prepared",
      resource: { kind: "decisionDraft", id: draft.id },
      accountId,
      data: draft,
    });
    return draft;
  }

  /** Drafts, optionally filtered to one record, newest first. */
  listDecisionDrafts(recordId?: string): MockDecisionDraft[] {
    const drafts =
      recordId === undefined
        ? this.decisionDrafts
        : this.decisionDrafts.filter((d) => d.recordId === recordId);
    return [...drafts].reverse();
  }

  /**
   * Mark every PREPARED draft on a record superseded - called by the decision
   * ceremonies themselves (advanceVerification, advancePayout's decided
   * states) and exposed as a driver for decisions that live app-side (the
   * reconciliation workspace resolves locally; no store mutation observes
   * it). Returns how many drafts were superseded. Emits no event of its own:
   * the decision that caused it already emitted through the standard path,
   * and `decision.superseded` is not part of the contract's vocabulary.
   */
  supersedeDecisionDrafts(recordType: MockDecisionRecordType, recordId: string): number {
    let superseded = 0;
    for (const draft of this.decisionDrafts) {
      if (draft.recordType !== recordType || draft.recordId !== recordId) continue;
      if (draft.status !== "PREPARED") continue;
      draft.status = "SUPERSEDED";
      draft.supersededAt = this.now();
      superseded += 1;
    }
    return superseded;
  }

  /**
   * Mock-only driver: set an account's `status`. NO contract operation writes
   * this field on either plane (the only status writes are the kyc patch, the
   * wallet aml patch, and the tenant's own status), so this driver exists to
   * make the frozen state demonstrable while the write op stays an open ask.
   * A console rendering this control must badge it as a driver, never as a
   * contract operation.
   */
  setAccountStatus(id: string, status: NonNullable<Account["status"]>): Account {
    const account = this.accounts.find((a) => a.id === id);
    if (!account) {
      throw new Error(`setAccountStatus: no account with id ${id} in the mock store.`);
    }
    const previous = account.status;
    account.status = status;
    account.version = (account.version ?? 0) + 1;
    this.emit({
      type: "account.status_changed",
      resource: { kind: "account", id },
      accountId: id,
      previous: { status: previous },
      data: account,
    });
    return account;
  }

  /** Mock-only driver: set a party's `status`. Same rationale as accounts. */
  setPartyStatus(id: string, status: NonNullable<Party["status"]>): Party {
    const party = this.parties.find((p) => p.id === id);
    if (!party) {
      throw new Error(`setPartyStatus: no party with id ${id} in the mock store.`);
    }
    const previous = party.status;
    party.status = status;
    party.version = (party.version ?? 0) + 1;
    party.updatedAt = this.now();
    this.emit({
      type: "party.status_changed",
      resource: { kind: "party", id },
      previous: { status: previous },
      data: party,
    });
    return party;
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
   * referenceCode defaults to the VBA's own referenceCode (or null). Pass null
   * explicitly to simulate a credit that arrives with no reference, which a
   * reconciliation flow has to match by hand.
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
    // currency the account never declared would teach a falsehood, so refuse.
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
    if (!(amount > 0)) {
      throw new Error(
        `simulateInboundCredit: amount must be greater than zero, got ${amount}. ` +
          `A credit that removes money is a debit, and there is no such simulation.`,
      );
    }
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
  // to explicit drivers, so no fixture asserts a transition the contract does
  // not document.

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
    this.emit({
      type: "payout_bank_account.created",
      resource: { kind: "payoutBankAccount", id: bankAccount.id as string },
      data: bankAccount,
    });
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
    // The create request is the only place the route<->bank-account pairing
    // exists; remember it so payouts embed the route's REAL beneficiary.
    this.routeBankAccounts.set(route.id as string, bankAccount.id as string);
    this.emit({
      type: "payout_route.created",
      resource: { kind: "payoutRoute", id: route.id as string },
      accountId: account.id as string,
      data: route,
    });
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
    const account = this.getAccount(ctx);
    const route = this.getPayoutRoute(ctx);
    if (route.status === "REJECTED") {
      badRequest(ctx, "A REJECTED route cannot be activated.");
    }
    const previous = route.status;
    route.status = "ACTIVE";
    route.updatedAt = this.now();
    this.emit({
      type: "payout_route.status_changed",
      resource: { kind: "payoutRoute", id: route.id as string },
      accountId: account.id as string,
      previous: { status: previous },
      data: route,
    });
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
    // would train integrators on fields the real list never returns. The
    // wire projection also strips the management twin: those fields exist
    // only on the management plane, so serving them here would teach a
    // finance read the contract does not make.
    return rows.map((p) => {
      const wire = toPayoutWire(p);
      if (!wire.payoutRoute) return wire;
      const route = [...this.payoutRoutes.values()]
        .flat()
        .find((r) => r.id === wire.payoutRoute?.id);
      return {
        ...wire,
        payoutRoute: {
          id: wire.payoutRoute.id,
          depositAsset: wire.payoutRoute.depositAsset,
          fiatCurrency: wire.payoutRoute.fiatCurrency,
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
    return toPayoutWire(payout);
  }

  /**
   * Mock-only read: the payout rows WITH their management twin (see
   * `MockPayoutManagementTwin`). An operator surface reads its second axis
   * here; the finance routes above never serve these fields.
   */
  listMockPayouts(accountId?: string): MockPayoutRow[] {
    const rows =
      accountId === undefined
        ? this.payouts
        : this.payouts.filter((p) => p.accountId === accountId);
    return rows.map((p) => ({ ...p }));
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
        // Wire projection: the stored intent row may have gained management
        // twin fields from a later driver call; a replay must not leak them.
        response: toPayoutWire(existing.result),
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
    // The beneficiary is the bank account this route was CREATED against -
    // never a lookalike picked by currency. An unmapped route (a profile
    // that declared no pairing) embeds no beneficiary rather than a guess.
    const routeBankAccountId = this.routeBankAccounts.get(route.id as string);
    const bankAccount = this.payoutBankAccounts.find((a) => a.id === routeBankAccountId);
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
        if (error instanceof MockLedgerError) ledgerError(ctx, error);
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
      response: toPayoutWire(payout),
    } as Record<string, unknown>) as schemas["IdempotentResponsePayoutDto"];
  }

  /**
   * Walk a payout to any documented status. COMPLETED stamps completedAt, a
   * send hash and settledFiatAmount – converted at the mock's seeded
   * non-parity exchange rate unless overridden, because a par default makes
   * the crypto and fiat sides numerically identical and hides the unit
   * distinction the desk exists to keep visible;
   * REJECTED/FAILED/RETURNED stamp a failureReason. The override arguments
   * let you control the settled amount, the send hash and the failure reason,
   * plus the management-ceremony fields the finance plane cannot carry:
   * `note`, `fiatReference` and `dakotaOfframpTxId` (confirm-completion),
   * `providerReference` (return), and `reconciliationState` (computed by the
   * management plane in production; the mock stores only what a driver
   * asserts and never defaults it). Ceremony fields persist on the mock row
   * - see `MockPayoutManagementTwin` - and are never served by the finance
   * routes.
   */
  advancePayout(
    id: string,
    to: NonNullable<Payout["status"]>,
    opts?: {
      settledFiatAmount?: number;
      failureReason?: string;
      sendTxHash?: string;
      note?: string;
      fiatReference?: string;
      dakotaOfframpTxId?: string;
      providerReference?: string;
      reconciliationState?: MockPayoutManagementTwin["reconciliationState"];
    },
  ): MockPayoutRow {
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
      // Never default at par: fiat per crypto unit comes from the mock's
      // seeded rate table, the same source every ramp reconciles against. A
      // pair the table does not carry must be settled explicitly - guessing
      // a rate and guessing par are the same class of taught falsehood.
      if (opts?.settledFiatAmount !== undefined) {
        payout.settledFiatAmount = opts.settledFiatAmount;
      } else {
        const fiat = payout.payoutRoute?.fiatCurrency;
        const rate = asset && fiat ? exchangeRates[`${asset}/${fiat}`] : undefined;
        if (rate === undefined) {
          throw new Error(
            `advancePayout: no exchange rate is configured for ${asset}/${fiat} in the mock - ` +
              `pass settledFiatAmount explicitly.`,
          );
        }
        payout.settledFiatAmount =
          Math.round((payout.cryptoAmount as number) * rate * 100) / 100;
      }
    }
    if (to === "REJECTED" || to === "FAILED" || to === "RETURNED") {
      payout.failureReason =
        opts?.failureReason ??
        payout.failureReason ??
        (to === "RETURNED"
          ? "Returned by the receiving bank"
          : "Rejected by the payout provider");
    }
    // Management-ceremony fields: persisted exactly as asserted, no defaults.
    if (opts?.note !== undefined) payout.note = opts.note;
    if (opts?.fiatReference !== undefined) payout.fiatReference = opts.fiatReference;
    if (opts?.dakotaOfframpTxId !== undefined) payout.dakotaOfframpTxId = opts.dakotaOfframpTxId;
    if (opts?.providerReference !== undefined) payout.providerReference = opts.providerReference;
    if (opts?.reconciliationState !== undefined) payout.reconciliationState = opts.reconciliationState;
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
    // The payout desk's exception ceremony lands here: confirm-completion
    // (COMPLETED) and return (RETURNED) are the human decisions, REJECTED is
    // the refused case. Any agent draft on the exception is now superseded.
    // Provider-side lifecycle steps (SENDING, PROVIDER_PROCESSING, FAILED)
    // are not decisions and leave drafts standing.
    if (to === "COMPLETED" || to === "RETURNED" || to === "REJECTED") {
      this.supersedeDecisionDrafts("payout_exception", id);
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
    const previous = bankAccount.status;
    bankAccount.status = to;
    bankAccount.updatedAt = this.now();
    // Same emit path as every other status driver: a consumer watching the
    // event stream (or bridging it into cache invalidation) must see this
    // transition, or the surface it renders goes stale forever.
    this.emit({
      type: "payout_bank_account.status_changed",
      resource: { kind: "payoutBankAccount", id },
      previous: { status: previous },
      data: bankAccount,
    });
    return bankAccount;
  }

  /** Walk a payout route to any documented status (e.g. simulate REJECTED). */
  advancePayoutRoute(id: string, to: NonNullable<PayoutRoute["status"]>): PayoutRoute {
    for (const [accountId, routes] of this.payoutRoutes.entries()) {
      const route = routes.find((r) => r.id === id);
      if (route) {
        const previous = route.status;
        route.status = to;
        route.updatedAt = this.now();
        this.emit({
          type: "payout_route.status_changed",
          resource: { kind: "payoutRoute", id },
          accountId,
          previous: { status: previous },
          data: route,
        });
        return route;
      }
    }
    throw new Error(`advancePayoutRoute: no payout route with id ${id} in the mock store.`);
  }
}

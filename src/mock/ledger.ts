import type { components } from "../generated/finance.js";

type schemas = components["schemas"];
type Wallet = schemas["WalletBalanceDto"];
type SupportedAsset = schemas["SupportedAssetView"];

/**
 * Raised when an operation would leave a balance in an impossible state:
 * spending more than an account has, reversing a credit the receiver no longer
 * holds, re-arming money that was already given back, or crediting an asset the
 * tenant does not support. Every message names the account, the asset, the
 * amounts involved, and what to do instead.
 */
export class MockLedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MockLedgerError";
  }
}

/**
 * What the money did, as opposed to what the status says. Ledger deltas are a
 * pure function of (from -> to), never of the status pair, which is what makes
 * every documented status jump total and every repeat idempotent.
 *
 *   NONE -> HELD -> DEBITED -> RETURNED
 *            |         |
 *            +---------+-> RELEASED
 */
export type FundsPhase = "NONE" | "HELD" | "DEBITED" | "RELEASED" | "RETURNED";

/** The receiving side of a transfer: credited, or not yet / no longer. */
export type CreditPhase = "NONE" | "CREDITED";

/** One row's worth of intended movement, in minor units. */
export interface LedgerLeg {
  accountId: string;
  asset: string;
  deltaTotal: bigint;
  deltaAvailable: bigint;
  deltaReserved: bigint;
  /** Create the wallet row if the account holds none for this asset. */
  createIfMissing?: boolean;
  /** Included in any invariant-breach message so the throw names the cause. */
  because: string;
}

/** Per (account, asset) view used by tests and `simulations.ledger.snapshot()`. */
export interface LedgerRow {
  accountId: string;
  asset: string;
  total: number;
  available: number;
  reserved: number;
  /**
   * The same three amounts as exact decimal strings.
   *
   * The numbers above are JS doubles, which cannot represent an asset with more
   * precision than about 15 significant digits: 1000 DAI plus 1 wei renders as
   * `1000`, identical to 1000 DAI. These strings are the authority the ledger
   * actually operates on, so compare them whenever exactness matters.
   */
  exact: { total: string; available: string; reserved: string };
}

export interface LedgerSnapshot {
  rows: LedgerRow[];
  /** Sum of `total` per asset across every account in the mock. */
  totalsByAsset: Record<string, number>;
  /** The same sums as exact decimal strings, for high-precision assets. */
  exactTotalsByAsset: Record<string, string>;
  /**
   * Money committed to a pending operation. Every reserved amount must have
   * one of these behind it.
   */
  holds: { id: string; accountId: string; asset: string; amount: number }[];
}

/** An open or historical hold the ledger tracks for I5 and for phase transitions. */
interface Hold {
  accountId: string;
  asset: string;
  /** Minor units. Fixed at hold time so a later amount edit cannot skew I5. */
  amount: bigint;
  phase: FundsPhase;
  /** Seeded rather than created at runtime — its delta was never posted. */
  hydrated: boolean;
}

interface Credit {
  accountId: string;
  asset: string;
  amount: bigint;
  phase: CreditPhase;
  hydrated: boolean;
}

const SCALE_CACHE = new Map<string, number>();

/**
 * Expand `1.5e-7` to `0.00000015` without rounding.
 *
 * `String(n)` switches to exponential notation below 1e-6, and `toFixed` ROUNDS
 * — it turns 1e-7 USDC into 0 and 1.5e-18 DAI into 1 wei, accepting amounts the
 * precision rule exists to refuse and, in the second case, creating money. Which
 * of those happens depended on JavaScript's choice of notation rather than on
 * the value, so the expansion has to be exact and the refusal has to come after.
 */
function expandExponential(text: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/.exec(text);
  if (!match) return text;
  const [, sign, whole, frac = "", exponent] = match;
  const digits = whole + frac;
  const point = whole.length + Number.parseInt(exponent, 10);
  if (point <= 0) return `${sign}0.${"0".repeat(-point)}${digits}`;
  if (point >= digits.length) return `${sign}${digits}${"0".repeat(point - digits.length)}`;
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
}

/**
 * Money is held as `BigInt` minor units. The seeds already carry 6-decimal
 * dust (`8020.000875`), so float addition would drift a balance away from
 * `total === available + reserved` after a handful of operations.
 */
export class Ledger {
  private readonly walletsRef: () => Map<string, Wallet[]>;
  private readonly supportedAssets: () => SupportedAsset[];
  private readonly holds = new Map<string, Hold>();
  private readonly credits = new Map<string, Credit>();
  /**
   * The authoritative balances, in minor units. `WalletBalanceDto.amount`
   * carries JS numbers, and a double cannot hold 18 decimal places: DAI ships
   * at `decimals: 18`, so re-deriving minor units from the rendered decimal
   * silently truncates every sub-microscopic amount. The ledger therefore owns
   * BigInt state and treats the wallet rows as a render-only projection.
   */
  private readonly balances = new Map<string, { total: bigint; available: bigint; reserved: bigint }>();

  constructor(wallets: () => Map<string, Wallet[]>, supportedAssets: () => SupportedAsset[]) {
    this.walletsRef = wallets;
    this.supportedAssets = supportedAssets;
  }

  /** Resolved per call: `reset()` replaces the Map object, not its contents. */
  private get wallets(): Map<string, Wallet[]> {
    return this.walletsRef();
  }

  private static balanceKey(accountId: string, asset: string): string {
    return `${accountId}\u0000${asset}`;
  }

  /** Adopt the wallet rows as the starting balances (seeds, or adopted state). */
  private syncFromWallets(): void {
    this.balances.clear();
    for (const [accountId, rows] of this.wallets) {
      for (const row of rows) {
        if (!row.asset || !row.amount) continue;
        this.balances.set(Ledger.balanceKey(accountId, row.asset), {
          total: this.toMinor(row.asset, row.amount.total ?? 0),
          available: this.toMinor(row.asset, row.amount.available ?? 0),
          reserved: this.toMinor(row.asset, row.amount.reserved ?? 0),
        });
      }
    }
  }

  // ── Units ────────────────────────────────────────────────────────────

  /** Decimals for an asset, from the tenant's supported-asset rows. */
  private decimals(asset: string): number {
    const cached = SCALE_CACHE.get(asset);
    if (cached !== undefined) return cached;
    const row = this.supportedAssets().find((a) => a.cryptoCurrency === asset);
    if (!row || row.decimals === undefined) {
      throw new MockLedgerError(
        `No supported asset row for ${asset}, so the mock cannot know its decimals. ` +
          `Add it to seeds.supportedAssets rather than assuming a default.`,
      );
    }
    SCALE_CACHE.set(asset, row.decimals);
    return row.decimals;
  }

  /**
   * Decimal -> minor units. Refuses to round: an amount finer than the asset
   * allows is the caller's bug, and silent truncation is how a ledger loses
   * money.
   */
  toMinor(asset: string, amount: number): bigint {
    const decimals = this.decimals(asset);
    if (!Number.isFinite(amount)) {
      throw new MockLedgerError(`Amount ${amount} is not a finite number.`);
    }
    // `String(n)` gives the shortest representation that round-trips, which is
    // the value the author wrote. `toFixed(20)` does NOT: it exposes the float
    // artifact (8020.000875 -> "8020.00087499999972351361"), so a legal
    // 6-decimal seed would look like a 20-decimal one and be rejected.
    // Exponential form is expanded exactly, so the precision check sees the
    // real number of decimals rather than a rounded stand-in.
    return this.parseExact(asset, expandExponential(String(amount)), amount);
  }

  /**
   * Exact decimal string -> minor units, with no float anywhere in the path.
   * `toMinor` goes through here after expanding notation; replication uses it
   * directly, so an adopted balance never passes through a double.
   */
  parseExact(asset: string, text: string, reportAs: unknown = text): bigint {
    const decimals = this.decimals(asset);
    const [whole, frac = ""] = text.split(".");
    const trimmed = frac.replace(/0+$/, "");
    if (trimmed.length > decimals) {
      throw new MockLedgerError(
        `Amount ${String(reportAs)} has more precision than ${asset} allows ` +
          `(${decimals} decimals). Amounts are never rounded to fit — that is how a ledger ` +
          `loses money — so pass an amount ${asset} can actually represent.`,
      );
    }
    const padded = trimmed.padEnd(decimals, "0");
    const sign = whole.startsWith("-") ? -1n : 1n;
    const wholeAbs = whole.replace("-", "") || "0";
    return sign * (BigInt(wholeAbs) * 10n ** BigInt(decimals) + BigInt(padded || "0"));
  }

  /**
   * Exact decimal string. `toDecimal` returns a JS number and so cannot render
   * an 18-decimal asset faithfully; this can, and is what the snapshot and the
   * refusal messages use when the rendered numbers would mislead.
   */
  toExact(asset: string, minor: bigint): string {
    const decimals = this.decimals(asset);
    const scale = 10n ** BigInt(decimals);
    const sign = minor < 0n ? "-" : "";
    const abs = minor < 0n ? -minor : minor;
    const frac = (abs % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
    return frac ? `${sign}${abs / scale}.${frac}` : `${sign}${abs / scale}`;
  }

  toDecimal(asset: string, minor: bigint): number {
    const decimals = this.decimals(asset);
    const scale = 10n ** BigInt(decimals);
    const sign = minor < 0n ? "-" : "";
    const abs = minor < 0n ? -minor : minor;
    const whole = abs / scale;
    const frac = (abs % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
    return Number(frac ? `${sign}${whole}.${frac}` : `${sign}${whole}`);
  }

  // ── Rows ─────────────────────────────────────────────────────────────

  private findRow(accountId: string, asset: string): Wallet | undefined {
    return (this.wallets.get(accountId) ?? []).find((w) => w.asset === asset);
  }

  private createRow(accountId: string, asset: string): Wallet {
    const supported = this.supportedAssets().find((a) => a.cryptoCurrency === asset);
    if (!supported) {
      throw new MockLedgerError(
        `Cannot open a ${asset} wallet row for account ${accountId}: no supported asset ` +
          `declares it, so the mock has no real contract address for it. Minting one ` +
          `would be a fixture teaching a falsehood.`,
      );
    }
    const row: Wallet = {
      asset,
      contractAddress: supported.contractAddress,
      amount: { total: 0, available: 0, reserved: 0 },
    };
    const rows = this.wallets.get(accountId) ?? [];
    rows.push(row);
    this.wallets.set(accountId, rows);
    return row;
  }

  /** Authoritative minor-unit balance; an account with no row reads as zero. */
  private read(accountId: string, asset: string): { total: bigint; available: bigint; reserved: bigint } {
    return (
      this.balances.get(Ledger.balanceKey(accountId, asset)) ?? {
        total: 0n,
        available: 0n,
        reserved: 0n,
      }
    );
  }

  // ── Atomic application ───────────────────────────────────────────────

  /**
   * Validate every leg against the balance rules and only then write any of
   * them. A
   * transfer moves two rows; if the second leg is illegal and the first has
   * already landed, `sum(total)` drifts by the transfer amount — a conservation
   * breach manufactured by the rule meant to protect non-negativity. So: all
   * legs, or none.
   */
  applyAtomic(legs: LedgerLeg[]): void {
    const projected = new Map<string, { total: bigint; available: bigint; reserved: bigint }>();
    for (const leg of legs) {
      const key = `${leg.accountId}:${leg.asset}`;
      const base = projected.get(key) ?? this.read(leg.accountId, leg.asset);
      const next = {
        total: base.total + leg.deltaTotal,
        available: base.available + leg.deltaAvailable,
        reserved: base.reserved + leg.deltaReserved,
      };
      if (next.available < 0n) {
        // Report what the account HAS and what the operation NEEDS. On a
        // high-precision asset those two can RENDER identically while still
        // differing - 1000 DAI and 1000 DAI minus one wei are both "1000" to a
        // double - and "has 1000 and needs 1000" reads as a broken mock. When
        // the rendered numbers collide, give the exact figures and the shortfall.
        const has = this.toDecimal(leg.asset, base.available);
        const needs = this.toDecimal(leg.asset, -leg.deltaAvailable);
        const collides = has === needs;
        const detail = collides
          ? `has ${this.toExact(leg.asset, base.available)} ${leg.asset} available (both ` +
            `render as ${has}, because ${leg.asset} carries more decimals than a JavaScript ` +
            `number can show) and this operation needs ` +
            `${this.toExact(leg.asset, -leg.deltaAvailable)}, a shortfall of ` +
            `${this.toExact(leg.asset, -next.available)}`
          : `has ${has} ${leg.asset} available and this operation needs ${needs}`;
        throw new MockLedgerError(
          `${leg.because}: account ${leg.accountId} ${detail}. Fund the account first — in ` +
            `mock mode, simulations.inbound.credit(virtualBankAccountId, amount) lands money ` +
            `the way a bank transfer does. No part of this operation was applied.`,
        );
      }
      if (next.total < 0n || next.reserved < 0n) {
        throw new MockLedgerError(
          `${leg.because}: would leave account ${leg.accountId} holding a negative amount of ` +
            `${leg.asset}. No part of this operation was applied.`,
        );
      }
      if (next.total !== next.available + next.reserved) {
        throw new MockLedgerError(
          `${leg.because}: would leave account ${leg.accountId}'s ${leg.asset} balance ` +
            `inconsistent — total must always equal available + reserved. No part of this ` +
            `operation was applied.`,
        );
      }
      // Both row problems are resolved here, before ANY write. Deferring the
      // supported-asset lookup to the write loop is what made a throw on the
      // second leg leave the first one applied - money destroyed by an
      // operation whose own error text said nothing had been applied.
      if (!this.findRow(leg.accountId, leg.asset)) {
        if (leg.createIfMissing !== true) {
          throw new MockLedgerError(
            `${leg.because}: account ${leg.accountId} holds no ${leg.asset} wallet row.`,
          );
        }
        this.assertCreatable(leg.accountId, leg.asset, leg.because);
      }
      projected.set(key, next);
    }

    for (const leg of legs) {
      const key = `${leg.accountId}:${leg.asset}`;
      const next = projected.get(key)!;
      this.balances.set(Ledger.balanceKey(leg.accountId, leg.asset), next);
      // Project onto the contract shape. This render is lossy for assets whose
      // precision exceeds a double (DAI at 18 decimals); the ledger above is
      // not, which is why it is the authority and this is the view.
      const row = this.findRow(leg.accountId, leg.asset) ?? this.createRow(leg.accountId, leg.asset);
      row.amount = {
        total: this.toDecimal(leg.asset, next.total),
        available: this.toDecimal(leg.asset, next.available),
        reserved: this.toDecimal(leg.asset, next.reserved),
      };
    }
  }

  /** Would `createRow` succeed? Asked during validation, never during a write. */
  private assertCreatable(accountId: string, asset: string, because: string): void {
    if (!this.supportedAssets().some((a) => a.cryptoCurrency === asset)) {
      throw new MockLedgerError(
        `${because}: cannot open a ${asset} wallet row for account ${accountId} because no ` +
          `supported asset declares it, so the mock has no real contract address to give it. ` +
          `Add ${asset} to the tenant's supported assets first. No part of this operation was ` +
          `applied.`,
      );
    }
  }

  // ── Phase machine ────────────────────────────────────────────────────

  private static readonly TERMINAL: FundsPhase[] = ["RELEASED", "RETURNED"];

  /** Deltas for one phase transition. Throws on a transition that cannot happen. */
  private phaseLegs(
    from: FundsPhase,
    to: FundsPhase,
    hold: { accountId: string; asset: string; amount: bigint },
    because: string,
  ): LedgerLeg[] {
    const A = hold.amount;
    const leg = (dt: bigint, da: bigint, dr: bigint, createIfMissing = false): LedgerLeg[] => [
      { accountId: hold.accountId, asset: hold.asset, deltaTotal: dt, deltaAvailable: da, deltaReserved: dr, createIfMissing, because },
    ];
    if (from === to) return [];
    if (Ledger.TERMINAL.includes(from)) {
      // RELEASED and RETURNED are the same financial end-state - the money is
      // back in `available`. The difference is narrative (rejected before it
      // left vs returned by the receiving bank), so walking between them moves
      // nothing. Re-arming to HELD or DEBITED is a different matter: that
      // would spend money the ledger has already given back.
      if (Ledger.TERMINAL.includes(to)) return [];
      throw new MockLedgerError(
        `${because}: ${from} is terminal and cannot move to ${to}. Money that has been ` +
          `released or returned is not re-armed; create a new operation instead.`,
      );
    }
    if (from === "NONE" && to !== "HELD") {
      throw new MockLedgerError(
        `${because}: money cannot go straight to ${to} without first being held.`,
      );
    }
    if (from === "NONE" && to === "HELD") return leg(0n, -A, A);
    if (from === "HELD" && to === "DEBITED") return leg(-A, 0n, -A);
    if (from === "HELD" && (to === "RELEASED" || to === "RETURNED")) return leg(0n, A, -A);
    // Money left the wallet and came back: re-credit, opening the row if the
    // account no longer holds one (a seeded in-flight payout is the real case).
    if (from === "DEBITED" && (to === "RELEASED" || to === "RETURNED")) return leg(A, A, 0n, true);
    throw new MockLedgerError(`${because}: undefined phase transition ${from} -> ${to}.`);
  }

  // ── Holds (sender side) ──────────────────────────────────────────────

  /** Register a seeded money object at its implied phase, posting no delta. */
  hydrateHold(id: string, accountId: string, asset: string, amount: number, phase: FundsPhase): void {
    this.holds.set(id, { accountId, asset, amount: this.toMinor(asset, amount), phase, hydrated: true });
  }

  /** Move a money object to a phase, applying exactly the delta that edge owes. */
  movePhase(
    id: string,
    to: FundsPhase,
    init: { accountId: string; asset: string; amount: number },
    because: string,
    extraLegs: LedgerLeg[] = [],
  ): void {
    const existing = this.holds.get(id);
    const hold: Hold = existing ?? {
      accountId: init.accountId,
      asset: init.asset,
      amount: this.toMinor(init.asset, init.amount),
      phase: "NONE",
      hydrated: false,
    };
    const legs = this.phaseLegs(hold.phase, to, hold, because);
    // Seeded objects post no delta on their first move only when that move is
    // the hydration itself; a real transition on a hydrated hold is backed by
    // the reserve check, which the seed check guarantees.
    this.applyAtomic([...legs, ...extraLegs]);
    hold.phase = to;
    this.holds.set(id, hold);
  }

  phaseOf(id: string): FundsPhase {
    return this.holds.get(id)?.phase ?? "NONE";
  }

  // ── Credits (receiver side) ──────────────────────────────────────────

  hydrateCredit(id: string, accountId: string, asset: string, amount: number): void {
    this.credits.set(id, { accountId, asset, amount: this.toMinor(asset, amount), phase: "CREDITED", hydrated: true });
  }

  /**
   * Legs for the receiving row. Reversal is refused when the receiver no
   * longer holds the money — the test is the balance, not who posted it: a
   * runtime credit that has since been spent is exactly as unreversible as a
   * seeded one.
   */
  creditLegs(
    id: string,
    to: CreditPhase,
    init: { accountId: string; asset: string; amount: number },
    because: string,
  ): LedgerLeg[] {
    const existing = this.credits.get(id);
    const credit: Credit = existing ?? {
      accountId: init.accountId,
      asset: init.asset,
      amount: this.toMinor(init.asset, init.amount),
      phase: "NONE",
      hydrated: false,
    };
    if (credit.phase === to) return [];
    const A = credit.amount;
    if (to === "CREDITED") {
      return [{ accountId: credit.accountId, asset: credit.asset, deltaTotal: A, deltaAvailable: A, deltaReserved: 0n, createIfMissing: true, because }];
    }
    const held = this.read(credit.accountId, credit.asset).available;
    if (held < A) {
      throw new MockLedgerError(
        `${because}: cannot reverse a credit of ${this.toDecimal(credit.asset, A)} ${credit.asset} ` +
          `to account ${credit.accountId}, which now holds only ` +
          `${this.toDecimal(credit.asset, held)} available. The money has already moved on.`,
      );
    }
    return [{ accountId: credit.accountId, asset: credit.asset, deltaTotal: -A, deltaAvailable: -A, deltaReserved: 0n, because }];
  }

  /** Record the credit phase after its legs have been applied atomically. */
  commitCredit(id: string, to: CreditPhase, init: { accountId: string; asset: string; amount: number }): void {
    const existing = this.credits.get(id);
    const credit: Credit = existing ?? {
      accountId: init.accountId,
      asset: init.asset,
      amount: this.toMinor(init.asset, init.amount),
      phase: "NONE",
      hydrated: false,
    };
    credit.phase = to;
    this.credits.set(id, credit);
  }

  // ── Invariants and snapshot ──────────────────────────────────────────

  /**
   * Checks every balance rule that can be judged from the current state:
   * `total` equals `available + reserved`, no amount is negative, and every
   * reserved amount has a pending operation behind it. Conservation (that the
   * system-wide total only moves on money entering or leaving) is a property of
   * a sequence of operations, not of one moment, so compare two `snapshot()`
   * calls for that.
   */
  verify(): void {
    for (const [accountId, rows] of this.wallets) {
      for (const row of rows) {
        if (!row.asset || !row.amount) continue;
        const { total, available, reserved } = this.read(accountId, row.asset);
        if (total !== available + reserved) {
          throw new MockLedgerError(
            `Account ${accountId}'s ${row.asset} balance is inconsistent: total ` +
              `${this.toDecimal(row.asset, total)} does not equal available ` +
              `${this.toDecimal(row.asset, available)} + reserved ` +
              `${this.toDecimal(row.asset, reserved)}.`,
          );
        }
        if (total < 0n || available < 0n || reserved < 0n) {
          throw new MockLedgerError(
            `Account ${accountId} holds a negative amount of ${row.asset}, which is not a ` +
              `state any balance can reach.`,
          );
        }
      }
    }
    const open = new Map<string, bigint>();
    for (const hold of this.holds.values()) {
      if (hold.phase !== "HELD") continue;
      const key = `${hold.accountId}:${hold.asset}`;
      open.set(key, (open.get(key) ?? 0n) + hold.amount);
    }
    const keys = new Set<string>(open.keys());
    for (const [accountId, rows] of this.wallets) {
      for (const row of rows) if (row.asset) keys.add(`${accountId}:${row.asset}`);
    }
    for (const key of keys) {
      const idx = key.lastIndexOf(":");
      const accountId = key.slice(0, idx);
      const asset = key.slice(idx + 1);
      const reserved = this.read(accountId, asset).reserved;
      const held = open.get(key) ?? 0n;
      if (reserved !== held) {
        throw new MockLedgerError(
          `Account ${accountId} reserves ${this.toDecimal(asset, reserved)} ${asset}, but ` +
            `${this.toDecimal(asset, held)} ${asset} of pending operations are outstanding ` +
            `against it — the two must match. Reserved money is money committed to ` +
            `something: every reserve needs a ` +
            `PENDING transfer or a REQUESTED payout behind it. If you supplied your own ` +
            `fixtures, supply the transfers and payouts alongside the balances they reserve ` +
            `against — replacing one without the other leaves the reserve unexplained.`,
        );
      }
    }
  }

  snapshot(): LedgerSnapshot {
    const rows: LedgerRow[] = [];
    const totalsMinor = new Map<string, bigint>();
    // Sorted so two snapshots compare deep-equal regardless of Map insertion
    // order, which the determinism contract depends on.
    for (const accountId of [...this.wallets.keys()].sort()) {
      const walletRows = [...(this.wallets.get(accountId) ?? [])]
        .filter((w) => w.asset)
        .sort((a, b) => String(a.asset).localeCompare(String(b.asset)));
      for (const row of walletRows) {
        const asset = row.asset as string;
        const { total, available, reserved } = this.read(accountId, asset);
        rows.push({
          accountId,
          asset,
          total: this.toDecimal(asset, total),
          available: this.toDecimal(asset, available),
          reserved: this.toDecimal(asset, reserved),
          exact: {
            total: this.toExact(asset, total),
            available: this.toExact(asset, available),
            reserved: this.toExact(asset, reserved),
          },
        });
        // Accumulated in minor units: routing each running total back through a
        // double would make the conservation quantity itself lossy.
        totalsMinor.set(asset, (totalsMinor.get(asset) ?? 0n) + total);
      }
    }
    const totalsByAsset: Record<string, number> = {};
    const exactTotalsByAsset: Record<string, string> = {};
    for (const [asset, minor] of [...totalsMinor].sort(([a], [b]) => a.localeCompare(b))) {
      totalsByAsset[asset] = this.toDecimal(asset, minor);
      exactTotalsByAsset[asset] = this.toExact(asset, minor);
    }
    const holds = [...this.holds.entries()]
      .filter(([, h]) => h.phase === "HELD")
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, h]) => ({ id, accountId: h.accountId, asset: h.asset, amount: this.toDecimal(h.asset, h.amount) }));
    return { rows, totalsByAsset, exactTotalsByAsset, holds };
  }

  /** The authoritative balances as exact strings, for replication. */
  exportBalances(): Record<string, { total: string; available: string; reserved: string }> {
    const out: Record<string, { total: string; available: string; reserved: string }> = {};
    for (const [key, amount] of [...this.balances].sort(([a], [b]) => a.localeCompare(b))) {
      const asset = key.slice(key.indexOf("\u0000") + 1);
      out[key] = {
        total: this.toExact(asset, amount.total),
        available: this.toExact(asset, amount.available),
        reserved: this.toExact(asset, amount.reserved),
      };
    }
    return out;
  }

  /**
   * Adopt a peer's authoritative balances. Without this, replication would
   * round-trip the ledger through the rendered doubles it exists to avoid, and
   * two replicas in one session would quietly disagree about a high-precision
   * balance while both passed `verify()`.
   */
  adoptBalances(state: Record<string, { total: string; available: string; reserved: string }>): void {
    this.balances.clear();
    for (const [key, amount] of Object.entries(state)) {
      const asset = key.slice(key.indexOf("\u0000") + 1);
      this.balances.set(key, {
        total: this.parseExact(asset, amount.total),
        available: this.parseExact(asset, amount.available),
        reserved: this.parseExact(asset, amount.reserved),
      });
    }
  }

  reset(): void {
    this.holds.clear();
    this.credits.clear();
    // Adopt whatever the wallet rows now say: seeds after a reset, or a peer's
    // state after adopting a snapshot.
    this.syncFromWallets();
  }
}

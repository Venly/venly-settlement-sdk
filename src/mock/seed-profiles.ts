import type { components } from "../generated/finance.js";
import type { FinanceSeeds } from "./store.js";
import type { VenlyFinanceSimulations } from "./finance.js";

type schemas = components["schemas"];

/**
 * A named cast of fixtures, plus the transitions that have to be *driven*
 * rather than seeded. A party that was denied carries a decision the operator
 * made; seeding the end state alone would give you the status with no event
 * behind it, which is exactly the kind of fixture that teaches a falsehood.
 */
export interface SeedProfile {
  name: string;
  description: string;
  seeds: Partial<FinanceSeeds>;
  after?(simulations: VenlyFinanceSimulations): void;
}

const party = (
  id: string,
  name: string,
  type: "INDIVIDUAL" | "ORGANISATION",
  status: Partial<schemas["PartyDto"]>,
): schemas["PartyDto"] => ({
  id,
  partyType: type,
  ...(type === "ORGANISATION" ? { companyName: name } : { firstName: name.split(" ")[0], lastName: name.split(" ")[1] }),
  createdAt: "2026-07-01T09:00:00Z",
  ...status,
});

const account = (
  id: string,
  externalId: string,
  name: string,
  status: Partial<schemas["AccountListItemDto"]>,
): schemas["AccountListItemDto"] => ({
  id,
  externalId,
  name,
  status: "ACTIVE",
  version: 1,
  createdAt: "2026-07-01T09:05:00Z",
  ...status,
});

const usdc = (total: number, available = total, reserved = 0) => [
  {
    asset: "USDC",
    contractAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    amount: { total, available, reserved },
  },
];

const P = {
  transacting: "c0a1e001-0000-4a00-9000-000000000001",
  ivSubmitted: "c0a1e001-0000-4a00-9000-000000000002",
  awaitingProof: "c0a1e001-0000-4a00-9000-000000000003",
  inFlight: "c0a1e001-0000-4a00-9000-000000000004",
  denied: "c0a1e001-0000-4a00-9000-000000000005",
  returned: "c0a1e001-0000-4a00-9000-000000000006",
} as const;

const A = {
  transacting: "c0a1e002-0000-4a00-9000-000000000001",
  ivSubmitted: "c0a1e002-0000-4a00-9000-000000000002",
  awaitingProof: "c0a1e002-0000-4a00-9000-000000000003",
  inFlight: "c0a1e002-0000-4a00-9000-000000000004",
  denied: "c0a1e002-0000-4a00-9000-000000000005",
  returned: "c0a1e002-0000-4a00-9000-000000000006",
} as const;

const beneficiary = {
  id: "c0a1e005-0000-4a00-9000-000000000001",
  partyId: P.inFlight,
  rail: "SEPA",
  label: "Cygnus EUR settlement",
  accountHolderName: "Cygnus Freight N.V.",
  bankName: "Example Bank N.V.",
  details: { ibanLast4: "6769", bic: "ABNABE2A" },
} satisfies schemas["PayoutBeneficiaryDto"];

const route = (
  id: string,
  status: NonNullable<schemas["PayoutRouteDto"]["status"]>,
  depositAddress: string,
): schemas["PayoutRouteDto"] => ({
  id,
  status,
  depositAsset: { chain: "BASE", name: "USDC" },
  fiatCurrency: "EUR",
  depositAddress,
  createdAt: "2026-07-20T10:00:00Z",
});

const ROUTE_IN_FLIGHT = "c0a1e004-0000-4a00-9000-000000000002";
const ROUTE_RETURNED = "c0a1e004-0000-4a00-9000-000000000003";

/**
 * Six personas, every state contract-real. The cast exists so a demo can show
 * the states a real desk actually sees - including the two integrators forget:
 * a denied applicant, and money that came BACK.
 */
export const demoCast: SeedProfile = {
  name: "demoCast",
  description:
    "Six personas covering approved-and-transacting, identity verification in flight, " +
    "a payout route awaiting ownership proof, a payout at the provider, a denied " +
    "organisation, and a returned payout.",
  seeds: {
    parties: [
      party(P.transacting, "Nova Retail", "ORGANISATION", { kybStatus: "VERIFIED" }),
      party(P.ivSubmitted, "Atlas Imports", "ORGANISATION", { kybStatus: "PENDING" }),
      party(P.awaitingProof, "Borea Labs", "ORGANISATION", { kybStatus: "VERIFIED" }),
      party(P.inFlight, "Cygnus Freight", "ORGANISATION", { kybStatus: "VERIFIED" }),
      // Seeded PENDING on purpose: `after` drives it to DENIED so the decision
      // carries an event, the way a real refusal does.
      party(P.denied, "Delta Holdings", "ORGANISATION", { kybStatus: "PENDING" }),
      party(P.returned, "Echo Marine", "ORGANISATION", { kybStatus: "VERIFIED" }),
    ],
    accounts: [
      account(A.transacting, "cast-transacting", "Nova Retail – operating", { kycStatus: "VERIFIED" }),
      account(A.ivSubmitted, "cast-iv-submitted", "Atlas Imports – onboarding", {
        kycStatus: "VERIFICATION_PENDING",
      }),
      account(A.awaitingProof, "cast-awaiting-proof", "Borea Labs – payouts", { kycStatus: "VERIFIED" }),
      account(A.inFlight, "cast-payout-in-flight", "Cygnus Freight – payouts", { kycStatus: "VERIFIED" }),
      account(A.denied, "cast-denied", "Delta Holdings – blocked", {
        kycStatus: "VERIFICATION_PENDING",
      }),
      account(A.returned, "cast-payout-returned", "Echo Marine – payouts", { kycStatus: "VERIFIED" }),
    ],
    wallets: {
      [A.transacting]: usdc(24500),
      [A.awaitingProof]: usdc(9000),
      // The in-flight payout is already DEBITED, so its amount is gone from
      // `total` rather than sitting in `reserved`.
      [A.inFlight]: usdc(7350),
      [A.returned]: usdc(11200),
    },
    partyRole: { partyId: P.transacting, roleType: "ACCOUNT_HOLDER", status: "ACTIVE" },
    virtualBankAccounts: [
      {
        id: "c0a1e003-0000-4a00-9000-000000000001",
        accountId: A.transacting,
        bankAccountType: "EUR_SEPA",
        name: "Nova Retail collections",
        status: "ACTIVE",
        currency: "EUR",
        targetCryptocurrency: "USDC",
        iban: "NL91ABNA0417164301",
        bic: "ABNANL2A",
        bankName: "Example Bank N.V.",
        beneficiaryName: "Nova Retail B.V.",
        referenceCode: "REF-NOVA-001",
        createdAt: "2026-07-02T08:00:00Z",
      },
    ],
    transfers: [
      {
        id: "c0a1e006-0000-4a00-9000-000000000001",
        senderAccountId: A.transacting,
        receiverAccountId: A.awaitingProof,
        chain: "BASE",
        asset: "USDC",
        amount: 1250,
        description: "Nova Retail – supplier run",
        status: "COMPLETED",
        transactionHash: "0xc0a1e0060000000000000000000000000000000000000000000000000000dead",
        createdAt: "2026-07-22T10:30:00Z",
      },
    ],
    payoutBankAccounts: [{ ...beneficiary, status: "ACTIVE", fiatCurrency: "EUR", createdAt: "2026-07-20T09:00:00Z" }],
    payoutRoutes: {
      [A.awaitingProof]: [
        route(
          "c0a1e004-0000-4a00-9000-000000000001",
          "AWAITING_OWNERSHIP_PROOF",
          "0xc0a1e004000000000000000000000000000000a1",
        ),
      ],
      [A.inFlight]: [route(ROUTE_IN_FLIGHT, "ACTIVE", "0xc0a1e004000000000000000000000000000000a2")],
      [A.returned]: [route(ROUTE_RETURNED, "ACTIVE", "0xc0a1e004000000000000000000000000000000a3")],
    },
    payouts: [
      {
        id: "c0a1e007-0000-4a00-9000-000000000001",
        accountId: A.inFlight,
        payoutRoute: {
          id: ROUTE_IN_FLIGHT,
          depositAsset: { chain: "BASE", name: "USDC" },
          fiatCurrency: "EUR",
          depositAddress: "0xc0a1e004000000000000000000000000000000a2",
          beneficiary,
        },
        rail: "SEPA",
        cryptoAmount: 2650,
        fundingMode: "PULL",
        status: "PROVIDER_PROCESSING",
        sendTxHash: "0xc0a1e0070000000000000000000000000000000000000000000000000000beef",
        requestedAt: "2026-08-15T11:00:00Z",
      },
      {
        id: "c0a1e007-0000-4a00-9000-000000000002",
        accountId: A.returned,
        payoutRoute: {
          id: ROUTE_RETURNED,
          depositAsset: { chain: "BASE", name: "USDC" },
          fiatCurrency: "EUR",
          depositAddress: "0xc0a1e004000000000000000000000000000000a3",
          beneficiary: { ...beneficiary, partyId: P.returned },
        },
        rail: "SEPA",
        cryptoAmount: 1800,
        fundingMode: "PULL",
        status: "RETURNED",
        sendTxHash: "0xc0a1e0070000000000000000000000000000000000000000000000000000cafe",
        failureReason: "Returned by the receiving bank: beneficiary name mismatch",
        requestedAt: "2026-08-12T14:20:00Z",
      },
    ],
    ivVerifications: [
      {
        partyId: P.ivSubmitted,
        ivCaseReference: "IV-ATLAS-0042",
        status: "SUBMITTED",
        linkedAt: "2026-08-16T09:12:00Z",
      },
    ],
  },
  after(simulations) {
    // A refusal is a decision someone made. Driving it produces the
    // party.verification_changed event a seeded DENIED would not have.
    simulations.verification.advance(P.denied, "DENIED");
  },
};

export const seedProfiles = { demoCast } as const;

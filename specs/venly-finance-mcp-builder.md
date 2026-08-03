# Feature: Venly Finance MCP Builder

## Problem

Venly already publishes the technical primitives required to build an international
money product: OpenAPI specifications, `@venlyfinance/sdk`, mock fixtures, and
`@venlyfinance/settlement-mcp`. The public story and the MCP surface do not yet expose
those primitives as one coherent builder experience.

Today the MCP is positioned as a human-gated settlement operator. It exposes a useful
but narrow subset of Finance and Fundflow operations, maintains a second HTTP transport
and a second set of hand-written API types, and ships workflow documents as package
files rather than discoverable MCP prompts/resources. An AI coding agent can inspect
settlement state, reconcile transactions, or dry-run selected writes, but it cannot
discover and execute the complete customer -> account -> wallet -> virtual bank account
golden path through the MCP.

This leaves three user problems:

1. A developer cannot see, from one reproducible example, how Venly's Wallet API and
   Finance API combine into a customer-facing international account experience.
2. An AI coding agent receives low-level tools without enough structured product and
   safety context to assemble them reliably.
3. Marketing is forced to promote an abstract infrastructure promise instead of a
   working, inspectable demonstration.

The primary users are fintech and platform CTOs, payments engineers, technical
founders, and compliance/product leaders evaluating whether Venly can shorten the path
from product concept to regulated money movement.

## Solution

Evolve the existing Settlement MCP into the **Venly Finance MCP**. This is one expanded
implementation, not a second MCP server.

The architecture has four explicit layers:

1. **OpenAPI specifications** remain endpoint and schema truth.
2. **`@venlyfinance/sdk`** becomes the only Finance/Fundflow execution transport used
   by application code and by the MCP.
3. **MCP tools** expose atomic financial capabilities with fail-closed write controls.
4. **MCP prompts/resources and packaged skills** assemble tools into product journeys;
   the host coding agent remains responsible for generating application code and UI.

The first golden journey is an **international account reference experience**:

1. Discover supported capabilities and constraints.
2. Create an individual or organisation party.
3. Create an account associated with that party; Venly auto-provisions its wallet.
4. Inspect the account and wallet.
5. Provision a EUR virtual bank account that converts incoming funds to USDC.
6. Create or dry-run an internal fiat-denominated transfer.
7. Inspect the transfer and reconcile received money by reference code.

The journey must run in explicit mock mode without credentials or network access. The
same application code must move to staging by changing configuration and supplying
credentials. Staging provisioning of a virtual bank account requires an account whose
KYC status is `VERIFIED`; neither the MCP nor the reference application may imply that
creating a party completes KYC/KYB.

### Product and naming decisions

- The implementation stays in `@venlyfinance/settlement-mcp` for compatibility during
  the 0.x line.
- The server name, documentation title, and preferred binary become **Venly Finance
  MCP** / `venly-finance-mcp`.
- The current `venly-settlement-mcp` binary remains as a compatibility alias.
- A future `@venlyfinance/mcp` npm alias may point to the same implementation, but it
  must not contain a forked server or separate tool set.
- Developer-facing documentation calls the example an "international account" or
  "money product". Campaign language may use **"Build the neobank experience. Not the
  banking stack."** only with copy that makes clear Venly provides infrastructure
  through regulated partners; it does not grant a bank charter or remove customer
  compliance obligations.

### Tool design rule

Tools expose atomic actions. Prompts and skills orchestrate those actions. There will
not be a `build_neobank` mega-tool: the MCP server does not write application files,
choose a regulatory model, or silently execute a chain of financial mutations.

### Phase 1 tool surface

Existing tools remain unless explicitly deprecated. New preferred tools use names and
schemas derived directly from the generated SDK types.

#### Read tools

| Tool | SDK method | Purpose |
|---|---|---|
| `list_accounts` | `finance.accounts.list` | Find accounts before creating duplicates |
| `get_account` | `finance.accounts.get` | Existing tool, migrated to SDK adapter |
| `list_wallets` | `finance.wallets.list` | Inspect the wallet auto-provisioned with an account |
| `list_virtual_bank_accounts` | `finance.virtualBankAccounts.list` | Existing tool, migrated to SDK adapter |
| `get_virtual_bank_account` | `finance.virtualBankAccounts.get` | Inspect IBAN, BIC, status and reference code |
| `list_transfers` | `finance.transfers.list` | Inspect transfer history and status |
| `get_transfer` | `finance.transfers.get` | Existing tool, migrated to SDK adapter |
| `list_parties` | `finance.parties.list` | Existing tool, migrated to SDK adapter |
| `get_party` | `finance.parties.get` | Inspect party and KYC/KYB state |

The existing Fundflow read tools and `reconcile_by_reference_code` remain available.

#### Write tools

| Tool | SDK method | Notes |
|---|---|---|
| `create_party` | `finance.parties.create` | Individual and organisation variants |
| `create_account` | `finance.accounts.create` | Existing `partyId` or inline party; wallet is auto-provisioned by the API |
| `create_virtual_bank_account` | `finance.virtualBankAccounts.create` | Requires KYC-verified account outside mock mode |
| `create_payment_session` | `finance.paymentSessions.create` | Existing tool, migrated to SDK adapter |
| `create_fiat_transfer` | `finance.transfers.createFiat` | Preferred replacement for `stage_transfer` |
| `create_crypto_transfer` | `finance.transfers.createCrypto` | Account-to-account crypto-denominated transfer |

The existing approval/rejection tools remain. Payment-request authorization,
settlement and reversal tools are Phase 2 because they represent a card-settlement
journey rather than the first international-account journey.

`stage_transfer` remains temporarily as a deprecated compatibility alias. Its current
input schema (`fiatAmount`, `fiatCurrency`, `cryptocurrency`) has drifted from the
vendored `CreateFiatTransferInput` schema (`amount`, `currency`, `idempotencyKey`). The
alias must translate legacy fields into the current SDK request and must never send the
stale body to the API. New examples and prompts use `create_fiat_transfer` only.

### MCP prompts and resources

Register the following discoverable resources:

- `venly://capabilities` — supported journeys, currencies/chains where known, and
  explicit unsupported capabilities such as card issuing.
- `venly://safety` — environment, confirmation, KYC/KYB, idempotency, approval and
  production-write rules.
- `venly://workflows/international-account` — ordered golden path, required inputs,
  expected states and recovery guidance.
- `venly://workflows/mock-to-staging` — what changes between simulation and staging,
  and what does not.

Register a `build_international_account` MCP prompt. It instructs the host coding agent
to:

1. establish the user's product, customer type and target geography without claiming
   unsupported coverage;
2. start in mock mode;
3. generate application code that uses `@venlyfinance/sdk` on the server side;
4. use the MCP tools to inspect/dry-run the workflow and validate schemas;
5. display compliance and pending states honestly in the UI;
6. keep credentials out of browser code and generated artifacts;
7. require an explicit user decision before switching to staging or arming writes.

The prompt is mirrored by a packaged skill at
`settlement-mcp/skills/build-international-account.md`. Existing workflow skill files
remain and are exposed through resources where practical.

### Environment and safety behavior

Environment choice must be explicit:

- `VENLY_ENV=mock`: the SDK mock transport executes simulated reads and writes without
  credentials or network. Results include `mode: "mock"` and are visibly synthetic.
- `VENLY_ENV=staging`: credentials are required for reads. Writes retain the current
  three-part gate: tool `confirm: true`, `VENLY_MCP_LIVE=1`, and credentials present.
- `VENLY_ENV=production`: all staging write gates apply, plus
  `VENLY_MCP_PRODUCTION=1`. The server logs the production environment to stderr at
  startup without logging credentials.

No implicit fallback from staging/production to mock is allowed. This prevents an
operator from mistaking fixtures for live account state. `VENLY_ENV` being absent keeps
the current staging behavior during the compatibility window; the mock quickstart sets
the variable explicitly.

All mutating tools must:

- be dry-run by default outside explicit mock mode;
- accept or generate a stable idempotency key where the API schema supports it;
- return the normalized request in dry-run output;
- return `mode`, `environment`, and the resulting resource in structured output;
- preserve Fundflow four-eyes and optimistic-locking requirements;
- never expose credentials, access tokens, or secrets in output or logs.

### Structured MCP output

Every Phase 1 tool returns both human-readable text content and machine-readable
`structuredContent`. Error responses preserve SDK error information that is safe and
useful to the agent: HTTP status, Venly error codes/messages, and trace code. Raw
authorization headers, tokens, and credentials are never included.

### Reference application and launch proof

Add `examples/international-account/` as a separately installable reference web
application. Runtime calls to the Finance API use `@venlyfinance/sdk` in server-side
routes; the browser never receives Venly credentials. The application demonstrates:

- customer/organisation onboarding form;
- account and auto-provisioned wallet state;
- EUR receiving account details in mock mode;
- send-money form with confirmation and visible status;
- transaction list and reference-code reconciliation;
- clear Mock / Staging environment treatment.

The committed reference application is the reproducible result, not evidence that MCP
itself generates UI. The launch proof is a screen recording of a coding agent starting
from the published prompt/resource, building or adapting the reference experience,
running it in mock mode, and explaining the switch to staging. Any time-to-build claim
is measured from the unedited recording and is not selected in advance.

Primary product message:

> AI can build the app. Venly supplies the financial infrastructure it cannot invent.

Supporting message:

> Build the neobank experience. Not the banking stack.

## Research Findings

- [`specs/finance.yaml`](finance.yaml) defines parties, accounts, auto-provisioned
  wallets, virtual bank accounts, payment sessions, payment requests, fiat/crypto
  transfers, permits and allowances.
- Finance API account creation accepts an existing party or inline party and
  auto-provisions a custodial wallet. Self-custody tenants must provide an address.
- The account wallet response includes per-token `total`, `available` and `reserved`
  balances, so the reference experience can show real balance states without adding a
  separate Wallet API call.
- Creating a virtual bank account currently supports EUR/SEPA in the published spec
  and requires the account's KYC status to be `VERIFIED`.
- [`src/finance/client.ts`](../src/finance/client.ts) already implements named methods
  for every Phase 1 Finance operation and supports a credential-free mock transport.
- [`settlement-mcp/src/client/http-client.ts`](../settlement-mcp/src/client/http-client.ts)
  duplicates authentication and HTTP behavior already handled more completely by the
  SDK. The MCP README already identifies SDK adoption as the intended next transport.
- The current MCP has 8 read tools, 4 human-gated write tools and one x402 quote stub.
- Existing safety tests prove that `confirm: true` cannot execute a write without the
  environment flag and credentials.
- The current `stage_transfer` MCP schema does not match the current vendored Finance
  OpenAPI request schema. Using the SDK adapter removes this class of drift.
- Local baseline on 2026-08-03: SDK suite 40/40 passing; MCP suite 24/24 passing.
- Dependency installation reported three high-severity audit findings in the SDK
  development dependency tree and two moderate findings in the MCP dependency tree.
  Remediation is separate discovered work; dependency versions must not be changed
  opportunistically as part of this feature without reviewing the audit paths.

## API Contract

The MCP does not introduce a new Venly HTTP API. It consumes the vendored contracts via
`@venlyfinance/sdk`.

### Golden-path Finance endpoints

| Method and path | SDK/MCP use | Success | Important errors/constraints |
|---|---|---|---|
| `POST /parties` | Create individual/organisation | `201 Party` | `400`, `401`, `403`, `409`, `500` |
| `GET /parties/{partyId}` | Inspect party/KYC/KYB | `200 Party` | `401`, `403`, `404`, `500` |
| `POST /accounts` | Create account and wallet | `201 Account` | `400`, `401`, `403`, `409`, `500` |
| `GET /accounts/{accountId}` | Inspect account state | `200 Account` | `401`, `403`, `404`, `500` |
| `GET /accounts/{accountId}/wallets` | List auto-provisioned wallets | `200 Wallet[]` | `401`, `403`, `404`, `500` |
| `POST /accounts/{accountId}/virtual-bank-accounts` | Provision EUR receiving account | `201 VirtualBankAccount` | `400`, `401`, `403`, `404`, `409`, `422`, `500`; KYC verified required |
| `POST /accounts/{senderAccountId}/transfers/fiat` | Fiat-denominated internal transfer | `201 Transfer` | `400`, `401`, `403`, `404`, `422`, `500`; receiver and funds validation |
| `POST /accounts/{senderAccountId}/transfers/crypto` | Crypto-denominated internal transfer | `201 Transfer` | `400`, `401`, `403`, `404`, `422`, `500` |
| `GET /accounts/{accountId}/transfers` | List transfer status/history | `200 Transfer[]` | `401`, `403`, `404`, `500` |

Authentication outside mock mode is OAuth2 client credentials. The SDK owns token
caching, early refresh, single-flight retrieval, 401 reauthentication, retry behavior,
idempotency headers and Venly error normalization.

## Data Model

No database or migration is introduced.

The MCP uses generated SDK/OpenAPI types for Finance and Fundflow payloads. MCP-specific
models are limited to:

- environment/mode metadata;
- dry-run envelopes and gate reasons;
- reconciliation inputs/results that do not exist as an API resource;
- structured MCP result envelopes.

Hand-written projections of API resources in `settlement-mcp/src/types.ts` are removed
after all tools use the SDK adapter. MCP input schemas remain Zod schemas, but their
field names, required fields and enumerations must be checked against generated SDK
types and protected by contract tests.

## Dependencies

- `@venlyfinance/sdk` becomes a runtime dependency of
  `@venlyfinance/settlement-mcp`.
- Existing `@modelcontextprotocol/sdk` and `zod` dependencies remain.
- No second HTTP client, OAuth implementation or retry implementation is added.
- The reference application is isolated under `examples/` so its UI/runtime
  dependencies do not increase the SDK or MCP installation footprint.
- Release order: publish the required SDK version first, then publish the MCP version
  whose dependency range includes it.

## Test Plan

### Unit and contract tests

- SDK adapter maps every MCP read/write call to the expected SDK resource method.
- Each new Zod input accepts current OpenAPI-valid payloads and rejects missing/invalid
  required fields.
- `stage_transfer` maps legacy inputs to a valid `CreateFiatTransferInput` and emits a
  deprecation notice.
- All tools produce `structuredContent` and sanitized error content.
- Mock mode performs zero network calls and labels every result as mock.
- Staging writes dry-run when any one of confirmation, write flag or credentials is
  absent.
- Production writes also dry-run unless `VENLY_MCP_PRODUCTION=1` is present.
- Idempotency keys are stable across a single dry-run/confirm cycle and caller-supplied
  keys are preserved.
- Existing ramp approval and reconciliation tests continue to pass unchanged in
  behavior.

### Integration tests

- In-process MCP client enumerates old and new tools, resources and prompt.
- Golden mock journey creates party -> account -> wallet -> vIBAN -> transfer and then
  reads all created state without network access.
- Staging smoke test remains read-only by default and verifies authentication plus at
  least parties, accounts and supported chains.
- An opt-in staging test uses a pre-verified test account for vIBAN provisioning; it is
  never part of ordinary CI and requires explicit credentials/flags.

### Reference application E2E

- Fresh install starts in explicit mock mode.
- Complete golden journey is usable at mobile and desktop viewport sizes.
- Browser bundles and responses contain no Venly client secret or access token.
- Switching configuration to staging does not require changing application business
  logic.
- Compliance/pending states are shown; the UI does not claim KYC is completed by party
  creation.

## Validation Gates

- `npm test` at repository root -> SDK build succeeds and all existing plus new tests
  pass.
- `npm run check` at repository root -> TypeScript exits 0.
- `npm test` in `settlement-mcp/` -> all legacy, adapter, safety, resource, prompt and
  golden-journey tests pass.
- `npm run typecheck` in `settlement-mcp/` -> TypeScript exits 0.
- `npm pack --dry-run` in both packages -> only intended distributable files are
  included; MCP package includes skills and new binary aliases.
- Run MCP with `VENLY_ENV=mock` and no credentials -> tools/resources/prompt enumerate;
  golden journey succeeds; network spy observes zero calls.
- Run MCP with `VENLY_ENV=staging`, no `VENLY_MCP_LIVE`, and mocked credentials ->
  confirmed write still returns dry-run and transport records zero write calls.
- Run MCP with `VENLY_ENV=production`, all ordinary live gates but no
  `VENLY_MCP_PRODUCTION` -> write returns dry-run.
- Build and inspect the reference application -> server-side SDK calls only; no Venly
  secret appears in client bundle.
- Record a clean-room coding-agent run from the published install instructions -> the
  international-account application runs in mock mode without unpublished files or
  private context.

## Acceptance Criteria

- [ ] There is one MCP implementation; no duplicate builder server is created.
- [ ] Every existing MCP tool retains its name and safety posture through the 0.x
      compatibility release.
- [ ] The MCP executes Finance/Fundflow operations through `@venlyfinance/sdk`; the
      duplicate HTTP/OAuth transport is removed.
- [ ] Phase 1 read and write tools listed above are implemented and contract-tested
      against the vendored OpenAPI schemas.
- [ ] `stage_transfer` no longer sends the stale request shape and is documented as
      deprecated in favor of `create_fiat_transfer`.
- [ ] Explicit mock mode supports the entire golden journey with no credentials and no
      network access.
- [ ] Staging and production writes fail closed; production requires an additional
      explicit production flag.
- [ ] Tools return safe `structuredContent` suitable for agent composition.
- [ ] Capabilities, safety, international-account and mock-to-staging resources are
      discoverable through MCP.
- [ ] The `build_international_account` prompt and matching packaged skill orchestrate
      atomic tools without silently executing writes.
- [ ] The reference application demonstrates party, account, wallet, EUR receiving
      account, transfer and reconciliation states using server-side SDK calls.
- [ ] Documentation distinguishes product experience from regulated banking status and
      states the KYC/KYB boundary.
- [ ] A clean-room user can reproduce the mock experience from the public package and
      repository instructions.
- [ ] Existing 64 baseline tests continue to pass alongside the new tests.

## Out of Scope

- Creating a new MCP server or a separate implementation under a new package.
- Bank licensing, KYC/KYB adjudication or claims that Venly eliminates customer
  regulatory obligations.
- Card issuing, card manufacturing, card-network membership or consumer deposit
  insurance; these are not present in the current Finance OpenAPI contract.
- Automatic production deployment or autonomous movement of production funds.
- Production x402 settlement; the existing x402 quote remains a non-executing stub.
- External-bank payouts not represented by the current Finance/Fundflow contracts.
- A general-purpose no-code application builder inside the MCP.
- Phase 2 payment-request settlement/reversal tools.
- Remediation of unrelated dependency audit findings without a separate dependency
  review.

## Risks & Open Questions

- **KYC/KYB journey:** The published Finance contract exposes status but not the full
  verification/document-submission journey. The reference application needs either a
  documented handoff or a pre-verified staging fixture; this must be confirmed with the
  product/compliance owner before staging launch.
- **Coverage language:** Current vIBAN provisioning is documented for EUR/SEPA. Claims
  about "global bank accounts" or broader geographic/currency coverage require a
  current provider/capability matrix and must not be inferred from the generic API
  model.
- **Balance semantics:** The Finance wallet response exposes token `total`, `available`
  and `reserved` amounts. Confirm product terminology and whether any fiat-equivalent
  display is contractually available; the first reference app should display the
  returned token amounts directly rather than inventing a fiat ledger balance.
- **Package naming:** Decide after the first clean-room test whether to publish the
  lightweight `@venlyfinance/mcp` alias. This is a distribution decision, not a second
  codebase.
- **Prompt portability:** MCP clients differ in prompt/resource support. The same
  workflow remains available as a packaged Markdown skill and normal documentation.
- **Mock fidelity:** Mock results must teach real states and errors without being
  mistaken for contractual availability. Fixtures require versioning alongside specs.
- **Dependency audit:** Reported npm audit findings require separate review to determine
  whether they affect distributable runtime code or only development tooling.

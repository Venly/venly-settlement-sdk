# Release Completion Plan: Venly Finance MCP Builder

**Spec:** `specs/venly-finance-mcp-builder.md`
**Implementation plan:** `specs/venly-finance-mcp-builder-plan.md`
**Pull request:** `Venly/venly-settlement-sdk#1`
**Goal:** Remove the last contract drift, prepare SDK `0.1.2` and MCP `0.2.0`, prove the staging boundary, then merge and publish a reproducible public builder foundation.
**Estimated tasks:** 8

## Verified Starting Point

- SDK build/typecheck and 40 tests pass.
- MCP build/typecheck and 54 tests pass.
- The MCP golden journey runs through the published SDK mock with zero network calls.
- Root and MCP npm audits report zero findings on the feature branch.
- All four GitHub checks pass.
- The remaining release gaps are hand-written API resource projections, release metadata,
  a credentialled staging smoke run, and merge/publish verification.

## Release Decisions

- Publish the root SDK as `0.1.2`. Its public API is compatible; the release contains
  packaging, metadata, documentation, and development dependency corrections.
- Publish `@venlyfinance/settlement-mcp` as `0.2.0`. The expanded builder surface is a
  substantial additive 0.x release and raises the Node floor to 20.
- Keep `@venlyfinance/settlement-mcp` as the package name and expose
  `venly-finance-mcp` as the preferred binary. Do not create a second MCP package now.
- Publish the SDK first and the MCP second.
- The staging gate is read-only plus one fail-closed dry-run assertion. It must not
  create a party, provision an account, or move money.
- A live provisioning journey remains opt-in follow-up work requiring a pre-verified
  staging account and explicit product/compliance approval.

## File Map

### 1. Contract cleanup

- Modify: `settlement-mcp/src/types.ts` — replace Finance and Fundflow resource/request
  projections with aliases to `FinanceComponents` and `FundflowComponents`; retain only
  MCP-specific, reconciliation, query, and legacy compatibility types locally.
- Modify: `settlement-mcp/src/client/sdk-client.ts` — remove casts that hide contract
  drift and keep legacy `stage_transfer` normalization explicit.
- Modify: `settlement-mcp/test/sdk-client.test.ts` — protect generated-type mappings and
  the legacy compatibility adapter.
- Modify: `settlement-mcp/test/helpers.ts` — make fixtures satisfy generated types.
- Modify: `settlement-mcp/src/reconcile.ts` — tolerate the generated vIBAN optionality
  without weakening reconciliation behavior.
- Modify: `settlement-mcp/test/reconcile.test.ts` — prove reconciliation still requires
  usable IDs/reference codes at runtime.

### 2. Release metadata

- Modify: `package.json` — bump SDK to `0.1.2`.
- Modify: `package-lock.json` — lock SDK `0.1.2` metadata.
- Modify: `CHANGELOG.md` — document the compatible SDK maintenance release.
- Modify: `settlement-mcp/package.json` — bump MCP to `0.2.0` and include its changelog.
- Modify: `settlement-mcp/package-lock.json` — lock MCP `0.2.0` metadata.
- Modify: `settlement-mcp/src/constants.ts` — report server version `0.2.0`.
- Create: `settlement-mcp/CHANGELOG.md` — document builder tools, safety, resources,
  prompt, SDK transport, Node 20, and compatibility aliases.
- Modify: `settlement-mcp/README.md` — replace “next 0.x” wording with published-release
  language after publication.

### 3. Staging and release gates

- Create: `settlement-mcp/scripts/staging-smoke.mjs` — exercise MCP discovery and
  credentialled staging reads, then prove a confirmed write remains dry-run while
  `VENLY_MCP_LIVE` is absent.
- Modify: `settlement-mcp/package.json` — add `smoke:staging`.
- Modify: `settlement-mcp/README.md` — document safe invocation and expected output.
- Modify: `.github/workflows/publish.yml` — add typecheck, audit, and package-content
  gates before either publish job.

## Tasks

### Task 1: Replace Finance API projections

**Files:**
- Modify: `settlement-mcp/src/types.ts`
- Modify: `settlement-mcp/src/client/sdk-client.ts`
- Test: `settlement-mcp/test/sdk-client.test.ts`

**Steps:**
- [ ] Add a failing compile-time usage that requires Finance resource and request types
      to come from `FinanceComponents["schemas"]`.
- [ ] Alias Party, Account, Wallet, vIBAN, Transfer, PaymentSession, and current create
      inputs to generated schema types.
- [ ] Remove Finance return/request casts from `SdkVenlyClient`; keep only the explicit
      legacy `stage_transfer` input and normalization.
- [ ] Verify — run `npm run typecheck && npm test -- --test-name-pattern='SDK client'`
      in `settlement-mcp/`; expect exit 0.
- [ ] Commit with message: `refactor(mcp): use generated finance contracts`

### Task 2: Replace Fundflow API projections

**Files:**
- Modify: `settlement-mcp/src/types.ts`
- Modify: `settlement-mcp/src/client/sdk-client.ts`
- Test: `settlement-mcp/test/helpers.ts`

**Steps:**
- [ ] Alias ramp list/detail and optimistic-locking payloads to
      `FundflowComponents["schemas"]`.
- [ ] Retain only MCP-owned list query parameters where the SDK does not export a named
      request type.
- [ ] Remove Fundflow casts and update test fixtures to satisfy the generated contract.
- [ ] Verify — run `npm run typecheck && npm test -- --test-name-pattern='ramp|approval'`;
      expect exit 0.
- [ ] Commit with message: `refactor(mcp): use generated fundflow contracts`

### Task 3: Preserve MCP-only and compatibility behavior

**Files:**
- Modify: `settlement-mcp/src/reconcile.ts`
- Test: `settlement-mcp/test/reconcile.test.ts`
- Test: `settlement-mcp/test/write-tools.test.ts`

**Steps:**
- [ ] Keep observed bank transactions, reconciliation results, environment metadata,
      and legacy `stage_transfer` input as explicitly MCP-owned types.
- [ ] Validate required runtime identifiers before reconciliation instead of asserting
      generated optional fields at compile time.
- [ ] Re-run stale-transfer, KYC-boundary, and fail-closed tests.
- [ ] Verify — run the full MCP typecheck and 54-test suite; expect no regression and no
      unsafe API-resource casts in `src/client/sdk-client.ts`.
- [ ] Commit with message: `test(mcp): lock compatibility boundaries`

### Task 4: Version and document SDK 0.1.2

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `CHANGELOG.md`

**Steps:**
- [ ] Bump the SDK package and lockfile version to `0.1.2` without changing its public
      API contract.
- [ ] Add release notes for corrected repository metadata, package contents, builder
      documentation, and dependency-audit cleanup.
- [ ] Verify — run `npm run check && npm test && npm pack --dry-run`; expect 40 tests and
      only intended SDK files in the tarball.
- [ ] Commit with message: `chore(release): prepare sdk 0.1.2`

### Task 5: Version and document MCP 0.2.0

**Files:**
- Modify: `settlement-mcp/package.json`
- Modify: `settlement-mcp/package-lock.json`
- Modify: `settlement-mcp/src/constants.ts`

**Steps:**
- [ ] Bump package, lockfile, and reported server version to `0.2.0`.
- [ ] Keep the old binary alias and make `venly-finance-mcp` the documented default.
- [ ] Verify — run the constants tests, build, and `npm pack --dry-run`; expect package,
      server, and tarball versions to agree.
- [ ] Commit with message: `chore(release): prepare finance mcp 0.2.0`

### Task 6: Publish the MCP changelog and harden release automation

**Files:**
- Create: `settlement-mcp/CHANGELOG.md`
- Modify: `settlement-mcp/README.md`
- Modify: `.github/workflows/publish.yml`

**Steps:**
- [ ] Document all additive 0.2.0 capabilities, security/runtime changes, deprecation,
      and regulated-product boundaries.
- [ ] Include the changelog in the package and remove pre-release wording from the
      README only when the version is publish-ready.
- [ ] Gate both publish jobs on typecheck, full audit, build, and package dry-run.
- [ ] Verify — validate workflow syntax and run both packages' local release commands.
- [ ] Commit with message: `ci(release): gate finance mcp publication`

### Task 7: Prove the staging boundary

**Files:**
- Create: `settlement-mcp/scripts/staging-smoke.mjs`
- Modify: `settlement-mcp/package.json`
- Modify: `settlement-mcp/README.md`

**Steps:**
- [ ] Start the compiled MCP with `VENLY_ENV=staging`, staging credentials, and no live
      write flag.
- [ ] Assert discovery returns 23 tools, four resources, and the builder prompt.
- [ ] Call staging reads for parties, accounts, and reference data; record only counts,
      statuses, and trace codes—never payload PII or credentials.
- [ ] Call a confirmed write with `VENLY_MCP_LIVE` absent and assert a dry-run result;
      do not create or mutate anything.
- [ ] Verify — run `npm run smoke:staging`; expect all checks `OK`, zero mutations, and
      exit 0. This task requires credentials supplied outside the repository.
- [ ] Commit with message: `test(mcp): add safe staging smoke journey`

### Task 8: Merge and publish the verified release

**Files:**
- No source changes expected.

**Steps:**
- [ ] Run clean installs from temporary directories for the root and MCP packages.
- [ ] Re-run SDK 40 tests, MCP 54 tests, typechecks, builds, audits, package dry-runs,
      zero-network golden journey, and staging smoke.
- [ ] Review the PR diff against every acceptance criterion and make PR #1 ready.
- [ ] Merge PR #1 after CI is green, then run the manual publish workflow in SDK-first,
      MCP-second order.
- [ ] Verify — install both public versions in a fresh temporary project, enumerate the
      MCP surface in mock mode, and confirm the golden journey without private files.

## Definition of Done

- [ ] `settlement-mcp/src/types.ts` contains no hand-written Finance/Fundflow resource
      payload projections.
- [ ] `SdkVenlyClient` does not hide schema drift behind return/request casts.
- [ ] SDK `0.1.2` and MCP `0.2.0` versions, changelogs, server identity, and tarballs
      agree.
- [ ] Full root and MCP audits report zero findings.
- [ ] The credentialled staging smoke passes without a live mutation.
- [ ] PR #1 is merged and both public packages install cleanly.
- [ ] The public mock builder journey is reproducible before reference-app work begins.

## Non-Goals

- Building the reference application in PR #1.
- Creating a second MCP package or mega-tool.
- Running an unapproved staging or production mutation.
- Claiming global account issuance, card issuing, bank status, or automatic KYC.

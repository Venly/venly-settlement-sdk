# Implementation Plan: Venly Finance MCP Builder

**Spec:** `specs/venly-finance-mcp-builder.md`
**Goal:** Evolve the existing Settlement MCP into one SDK-backed Venly Finance MCP that an AI coding agent can use to build and verify an international-account reference experience safely.
**Estimated tasks:** 18

## File Map

### Package and transport foundation

- Modify: `settlement-mcp/package.json` — add SDK runtime dependency and preferred binary alias.
- Modify: `settlement-mcp/package-lock.json` — lock SDK dependency.
- Create: `settlement-mcp/src/client/sdk-client.ts` — adapt Finance/Fundflow SDK clients to the MCP client contract.
- Test: `settlement-mcp/test/sdk-client.test.ts` — prove SDK method mapping and mock zero-network behavior.
- Modify: `settlement-mcp/src/index.ts` — construct the SDK adapter from explicit environment configuration.
- Modify: `settlement-mcp/src/constants.ts` — server identity and environment constants.
- Modify: `settlement-mcp/src/types.ts` — expand the temporary client contract, then reduce it to MCP-only types.
- Delete: `settlement-mcp/src/client/http-client.ts` — remove duplicate HTTP/OAuth transport after parity tests pass.

### Safety and tool surface

- Modify: `settlement-mcp/src/safety.ts` — model mock/staging/production gates.
- Test: `settlement-mcp/test/write-tools.test.ts` — cover mock execution and production's additional fail-closed gate.
- Modify: `settlement-mcp/src/tools/read-tools.ts` — add account, wallet, vIBAN, transfer and party reads.
- Test: `settlement-mcp/test/read-tools.test.ts` — validate new read schemas and results.
- Modify: `settlement-mcp/src/tools/write-tools.ts` — add party/account/vIBAN/fiat/crypto writes and correct transfer contract.
- Modify: `settlement-mcp/test/helpers.ts` — extend in-memory client fixtures and call tracking.
- Test: `settlement-mcp/test/contract-tools.test.ts` — validate Phase 1 Zod inputs against OpenAPI-valid examples.
- Create: `settlement-mcp/src/results.ts` — shared text plus structured MCP result/error serializer.
- Test: `settlement-mcp/test/results.test.ts` — verify structured output and secret sanitization.

### Discovery and orchestration

- Create: `settlement-mcp/src/resources.ts` — register capability, safety and workflow resources.
- Test: `settlement-mcp/test/resources.test.ts` — enumerate and read resources.
- Create: `settlement-mcp/src/prompts.ts` — register `build_international_account`.
- Test: `settlement-mcp/test/prompts.test.ts` — enumerate/render prompt with required guardrails.
- Create: `settlement-mcp/skills/build-international-account.md` — portable workflow skill.
- Create: `settlement-mcp/skills/mock-to-staging.md` — environment transition skill.
- Modify: `settlement-mcp/src/server.ts` — register resources and prompts with tools.

### Mock fidelity and golden journey

- Modify: `src/mock/transport.ts` — add deterministic state support required by create-then-read journeys.
- Modify: `src/mock/finance.ts` — define state transitions for party/account/vIBAN/transfer fixtures.
- Test: `test/mock.test.mjs` — prove state isolation, persistence and zero-network behavior.
- Test: `settlement-mcp/test/golden-journey.test.ts` — execute the complete mock journey over MCP.

### Product packaging and proof

- Modify: `settlement-mcp/README.md` — Venly Finance MCP positioning, mock quickstart, safety and workflow docs.
- Modify: `README.md` — builder-first repository entry and package relationship.
- Modify: `settlement-mcp/package.json` — final metadata and included files.
- Create: `examples/international-account/package.json` — isolated reference-app dependencies and commands.
- Create: `examples/international-account/src/server.ts` — server-side SDK boundary.
- Create: `examples/international-account/src/journey.ts` — golden-path application service.
- Create: `examples/international-account/src/app.tsx` — customer, account, receiving and transfer UI.
- Create: `examples/international-account/src/styles.css` — responsive reference-app presentation.
- Test: `examples/international-account/test/journey.test.ts` — mock business-flow tests.
- Test: `examples/international-account/test/secrets.test.ts` — verify browser output excludes credentials.
- Create: `examples/international-account/README.md` — clean-room run and staging transition.
- Create: `docs/launch-proof.md` — recording protocol and permitted product claims.

## Tasks

### Task 1: Add the SDK dependency

**Files:**
- Modify: `settlement-mcp/package.json`
- Modify: `settlement-mcp/package-lock.json`

**Steps:**
- [ ] Add the current compatible `@venlyfinance/sdk` release as a runtime dependency.
- [ ] Install from the lockfile and confirm the package resolves from a clean install.
- [ ] Verify — run `npm install && npm ls @venlyfinance/sdk` in `settlement-mcp/`, expect one resolved SDK version and exit 0.
- [ ] Commit with message: `build(mcp): depend on the finance sdk`

### Task 2: Implement and test the SDK adapter

**Files:**
- Create: `settlement-mcp/src/client/sdk-client.ts`
- Test: `settlement-mcp/test/sdk-client.test.ts`
- Modify: `settlement-mcp/src/types.ts`

**Steps:**
- [ ] Write failing tests for Finance/Fundflow read and write method mapping.
- [ ] Implement `SdkVenlyClient` over `VenlyFinanceClient` and `FundflowClient`.
- [ ] Add an explicit mock constructor and prove global `fetch` is untouched.
- [ ] Verify — run `npm test -- --test-name-pattern='SDK client'`, expect adapter tests pass.
- [ ] Commit with message: `feat(mcp): add sdk-backed client adapter`

### Task 3: Switch the MCP entrypoint to explicit environments

**Files:**
- Modify: `settlement-mcp/src/index.ts`
- Modify: `settlement-mcp/src/constants.ts`
- Test: `settlement-mcp/test/constants.test.ts`

**Steps:**
- [ ] Add tests for absent, mock, staging and production environment selection.
- [ ] Construct `SdkVenlyClient` instead of `HttpVenlyClient` in the CLI entrypoint.
- [ ] Log server name, environment and armed/disarmed state to stderr without secrets.
- [ ] Verify — run `npm test -- --test-name-pattern='environment|default URLs'`, expect exit 0.
- [ ] Commit with message: `feat(mcp): select sdk environment explicitly`

### Task 4: Extend the fail-closed safety model

**Files:**
- Modify: `settlement-mcp/src/safety.ts`
- Test: `settlement-mcp/test/write-tools.test.ts`
- Modify: `settlement-mcp/src/constants.ts`

**Steps:**
- [ ] Write failing tests for mock, staging and production gate matrices.
- [ ] Allow explicit mock execution without credentials while labelling it synthetic.
- [ ] Require `VENLY_MCP_PRODUCTION=1` in addition to all current gates for production.
- [ ] Verify — run `npm test -- --test-name-pattern='CRITICAL|production|mock'`, expect all gate tests pass.
- [ ] Commit with message: `feat(mcp): gate writes by environment`

### Task 5: Remove the duplicate HTTP transport

**Files:**
- Delete: `settlement-mcp/src/client/http-client.ts`
- Modify: `settlement-mcp/src/types.ts`
- Test: `settlement-mcp/test/sdk-client.test.ts`

**Steps:**
- [ ] Prove every existing client method has SDK-adapter parity.
- [ ] Delete the vendored token/fetch transport and unused hand-written API projections.
- [ ] Keep only MCP-specific reconciliation and dry-run types locally.
- [ ] Verify — run `npm run typecheck && npm test`, expect exit 0 and all legacy tests pass.
- [ ] Commit with message: `refactor(mcp): remove duplicate api transport`

### Task 6: Add the Phase 1 read tools

**Files:**
- Modify: `settlement-mcp/src/tools/read-tools.ts`
- Modify: `settlement-mcp/test/helpers.ts`
- Test: `settlement-mcp/test/read-tools.test.ts`

**Steps:**
- [ ] Write failing list/get tests for accounts, wallets, vIBANs, transfers and parties.
- [ ] Register the new atomic read tools with read-only annotations.
- [ ] Preserve all existing tool names and behavior.
- [ ] Verify — run `npm test -- --test-name-pattern='list_accounts|list_wallets|get_party|list_transfers'`, expect exit 0.
- [ ] Commit with message: `feat(mcp): expose finance account reads`

### Task 7: Add party, account and vIBAN write tools

**Files:**
- Modify: `settlement-mcp/src/tools/write-tools.ts`
- Modify: `settlement-mcp/test/helpers.ts`
- Test: `settlement-mcp/test/write-tools.test.ts`

**Steps:**
- [ ] Write failing dry-run, mock and armed-write tests for the three tools.
- [ ] Register OpenAPI-aligned Zod inputs for individual/organisation parties, accounts and vIBANs.
- [ ] Include idempotency and KYC boundary guidance in descriptions/results.
- [ ] Verify — run `npm test -- --test-name-pattern='create_party|create_account|create_virtual_bank_account'`, expect exit 0.
- [ ] Commit with message: `feat(mcp): add account provisioning tools`

### Task 8: Correct and expand transfer tools

**Files:**
- Modify: `settlement-mcp/src/tools/write-tools.ts`
- Modify: `settlement-mcp/test/helpers.ts`
- Test: `settlement-mcp/test/contract-tools.test.ts`

**Steps:**
- [ ] Write failing contract tests from `CreateFiatTransferInput` and `CreateCryptoTransferInput` examples.
- [ ] Add preferred `create_fiat_transfer` and `create_crypto_transfer` tools.
- [ ] Retain `stage_transfer` as a deprecated mapper and prove it cannot send stale fields.
- [ ] Verify — run `npm test -- --test-name-pattern='transfer contract|stage_transfer'`, expect exit 0.
- [ ] Commit with message: `fix(mcp): align transfer tools with openapi`

### Task 9: Return structured and sanitized results

**Files:**
- Create: `settlement-mcp/src/results.ts`
- Modify: `settlement-mcp/src/tools/read-tools.ts`
- Test: `settlement-mcp/test/results.test.ts`

**Steps:**
- [ ] Write failing tests for text plus `structuredContent` output and sanitized SDK errors.
- [ ] Implement shared success/error serializers.
- [ ] Migrate read tools; write-tool migration follows in its existing test task if needed.
- [ ] Verify — run `npm test -- --test-name-pattern='structured|sanitize'`, expect exit 0.
- [ ] Commit with message: `feat(mcp): return structured safe results`

### Task 10: Register capability and safety resources

**Files:**
- Create: `settlement-mcp/src/resources.ts`
- Modify: `settlement-mcp/src/server.ts`
- Test: `settlement-mcp/test/resources.test.ts`

**Steps:**
- [ ] Write failing enumeration/read tests for all four specified resource URIs.
- [ ] Register capability, safety, international-account and mock-to-staging resources.
- [ ] State unsupported capabilities and the KYC/global-coverage boundaries explicitly.
- [ ] Verify — run `npm test -- --test-name-pattern='resources'`, expect all resources enumerate/read.
- [ ] Commit with message: `feat(mcp): publish builder resources`

### Task 11: Register the builder prompt and portable skills

**Files:**
- Create: `settlement-mcp/src/prompts.ts`
- Create: `settlement-mcp/skills/build-international-account.md`
- Test: `settlement-mcp/test/prompts.test.ts`

**Steps:**
- [ ] Write a failing prompt enumeration/render test.
- [ ] Register `build_international_account` with server-side secrets and explicit-environment guardrails.
- [ ] Mirror the orchestration in the portable skill file.
- [ ] Verify — run `npm test -- --test-name-pattern='build_international_account'`, expect prompt content and constraints pass.
- [ ] Commit with message: `feat(mcp): add international account builder prompt`

### Task 12: Add mock-to-staging orchestration guidance

**Files:**
- Create: `settlement-mcp/skills/mock-to-staging.md`
- Modify: `settlement-mcp/src/resources.ts`
- Test: `settlement-mcp/test/resources.test.ts`

**Steps:**
- [ ] Document invariant application logic and changed credentials/environment.
- [ ] Add KYC-verified fixture, write-arming and no-fallback checks.
- [ ] Verify — run `npm test -- --test-name-pattern='mock-to-staging'`, expect resource matches the packaged skill.
- [ ] Commit with message: `docs(mcp): define mock to staging handoff`

### Task 13: Make the SDK mock support a stateful journey

**Files:**
- Modify: `src/mock/transport.ts`
- Modify: `src/mock/finance.ts`
- Test: `test/mock.test.mjs`

**Steps:**
- [ ] Write failing create-then-get/list tests with state isolated per client instance.
- [ ] Add deterministic state transitions for the golden-path resources.
- [ ] Preserve all existing fixture and error-injection behavior.
- [ ] Verify — run `npm test -- --test-name-pattern='stateful|zero network|fixtures are cloned'`, expect exit 0.
- [ ] Commit with message: `feat(sdk): make finance mock journey stateful`

### Task 14: Prove the complete MCP golden journey

**Files:**
- Test: `settlement-mcp/test/golden-journey.test.ts`
- Modify: `settlement-mcp/test/helpers.ts`
- Modify: `settlement-mcp/src/server.ts`

**Steps:**
- [ ] Execute party -> account -> wallet -> vIBAN -> transfer -> reconciliation through an in-memory MCP client.
- [ ] Assert every result is visibly mock and no network call occurs.
- [ ] Assert the journey exposes, but does not bypass, KYC and confirmation boundaries.
- [ ] Verify — run `npm test -- --test-name-pattern='golden journey'`, expect exit 0.
- [ ] Commit with message: `test(mcp): prove international account journey`

### Task 15: Reposition and package Venly Finance MCP

**Files:**
- Modify: `settlement-mcp/README.md`
- Modify: `README.md`
- Modify: `settlement-mcp/package.json`

**Steps:**
- [ ] Lead with the builder outcome and include the explicit mock quickstart.
- [ ] Document compatibility names, safety behavior and the honest product/regulatory boundary.
- [ ] Correct repository/homepage/bugs metadata to `Venly/venly-settlement-sdk`.
- [ ] Verify — run `npm pack --dry-run` in both packages and inspect file lists.
- [ ] Commit with message: `docs: position the venly finance mcp builder`

### Task 16: Build the reference-app service boundary

**Files:**
- Create: `examples/international-account/package.json`
- Create: `examples/international-account/src/journey.ts`
- Test: `examples/international-account/test/journey.test.ts`

**Steps:**
- [ ] Write failing service tests for the mock golden journey.
- [ ] Implement a server-only journey service over `@venlyfinance/sdk`.
- [ ] Verify — run the example service tests, expect party/account/vIBAN/transfer results and zero network calls.
- [ ] Commit with message: `feat(example): add international account service`

### Task 17: Build and verify the reference UI

**Files:**
- Create: `examples/international-account/src/app.tsx`
- Create: `examples/international-account/src/styles.css`
- Test: `examples/international-account/test/secrets.test.ts`

**Steps:**
- [ ] Write a failing test proving credentials never enter browser output.
- [ ] Build responsive customer, account, receiving and transfer states over the service boundary.
- [ ] Display Mock/Staging and compliance/pending states explicitly.
- [ ] Verify — run the example tests/build and inspect the client bundle for Venly secrets.
- [ ] Commit with message: `feat(example): add international account interface`

### Task 18: Publish the clean-room launch proof

**Files:**
- Create: `examples/international-account/README.md`
- Create: `docs/launch-proof.md`
- Modify: `README.md`

**Steps:**
- [ ] Document public-package setup and the mock-to-staging transition.
- [ ] Define the unedited recording protocol and permitted product claims.
- [ ] Run a clean-room coding-agent build and record its measured time and deviations.
- [ ] Verify — a fresh environment reproduces the mock experience without private files or credentials.
- [ ] Commit with message: `docs: publish finance mcp launch proof`

## Verification

- [ ] Run `npm test` and `npm run check` at repository root.
- [ ] Run `npm test` and `npm run typecheck` in `settlement-mcp/`.
- [ ] Run all example tests and production build in `examples/international-account/`.
- [ ] Run `git diff --check`.
- [ ] Run `npm pack --dry-run` for SDK and MCP and inspect contents.
- [ ] Run `npm audit --omit=dev`; require zero runtime findings or documented security-owner acceptance before publish.
- [ ] Execute the mock golden journey with a network spy and no credentials.
- [ ] Re-run the staging and production fail-closed matrices.
- [ ] Review the final diff against every acceptance criterion in the feature spec.
- [ ] Perform the clean-room public-package demonstration and record measured build time.

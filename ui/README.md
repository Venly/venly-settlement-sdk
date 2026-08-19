# @venlyfinance/ui

Copy-owned UI kit for money products built on [`@venlyfinance/react`](../react/README.md). Not an npm package: these files land in your repo, where you own and restyle them. Delivery rides the shadcn registry standard – add one line to your `components.json`:

```json
{ "registries": { "@venlyfinance": "https://raw.githubusercontent.com/Venly/venly-settlement-sdk/main/ui/r/{name}.json" } }
```

then install blocks with the CLI you already use:

```bash
npx shadcn@latest add @venlyfinance/receive @venlyfinance/send @venlyfinance/activity
```

Each block pulls its components, the `venly-tokens` file and the `@venlyfinance/react` data layer transitively. The registry JSON under [`r/`](r/) is generated from [`registry/`](registry/) by `npm run build:registry` and CI fails on drift; copying files straight from `registry/` also works.

Building with a coding agent? Run `npx shadcn add @venlyfinance/agents` to land AGENTS.md in your own repo root.

## The white-label contract

[`registry/styles/tokens.css`](registry/styles/tokens.css) is the reskin surface – **a reskin must be that file and nothing else**. Every skin-relevant value – colour, radius, type scale, density, spacing rhythm, border weights, panel geometry, elevation – is a custom property read from that file. No component carries a raw colour or a raw pixel value in any box property; the only literals left at call sites are structural geometry a reskin should not change (positioning zeros, 50% circles, font weights, unitless line-heights, and em-relative proportions like the currency code at 0.6× its digits). A test enforces this – see the last case in [`test/contract.test.tsx`](test/contract.test.tsx).

Acceptance test for any palette: map every `--state-*` pair to greys and confirm status is still legible. The kit holds up its half by pairing every state with a glyph or word; your palette must keep `-fg`/`-bg` contrast.

## What's here

| File | Component | The rules it encodes |
|---|---|---|
| `registry/lib/money.tsx` | `Money`, `formatAmount` | Tabular figures always · trailing currency code at 0.6× one tone down · true minus `−` · debits are not red · empty value = em-dash |
| `registry/components/status-pill.tsx` | `StatusPill` | Word + glyph on every state (greyscale-legible) · 4px data-value rectangle · tinted bg + dark text of the same ramp · cancelled is grey `↺`, never red |
| `registry/components/data-table.tsx` | `DataTable`, `RowText` | Row pitch ÷ body size 2.4–3.8× via `--row-pitch` · hairline-only 32px header · money right-aligned · hover tint, no zebra, no shadow · em-dash empties · truncate, never wrap |
| `registry/components/timeline.tsx` | `Timeline` | Three-axis state (node, rail, label) · solid past / dotted future, never inverted · donut current + bold label · terminal failure is never a green check |
| `registry/components/balance-card.tsx` | `BalanceCard` | Available is the only figure above the rule, ~2× everything else · reserved demoted by position and scale, not colour · padlock for unspendable · mechanism-naming bucket labels |
| `registry/components/side-panel.tsx` | `SidePanel` | Row click opens a panel, never navigates · no scrim · hero is the amount · `↑ ↓ Esc` row-stepping footer |
| `registry/components/list-error.tsx` | `ListLoadError` | `resultPresent === false` is an error, never an empty list · `role="alert"` · names what failed and admits the list may be incomplete · retry wired to the query's refetch |
| `registry/blocks/auth.tsx` | `SignInForm`, `TwoFactorForm`, `SignUpForm`, `AuthAdapter`, `createMockAuthAdapter` | Bring-your-own-auth boundary: the Venly APIs authenticate machines, never people · no user enumeration in credential errors · six-slot 2FA code with paste + keyboard support · session-expiry contract (`session()` → null) |
| `registry/blocks/team.tsx` | `TeamTable`, `InviteDialog`, `TeamAdapter`, `createMockTeamAdapter` | Member status as word + glyph · row-level role controls with role descriptions · self-actions disabled with the reason · mock invites mint a link, never claim an email went out |
| `registry/blocks/onboarding.tsx` | `CompanyForm`, `VerificationStatusHome`, `RestrictedBanner` | Verification status rendered verbatim from the records (no invented steps or SLAs) · waiting state answers must-I-act / who-has-it / how-long / what-still-works · humane decline with review as the primary action |
| `registry/blocks/activity.tsx` | `UnifiedActivityBlock`, `ActivityBlock` | One feed over both money rails (account transfers + company withdrawals/add-money) with a labelled Scope column · three bands: In progress / Completed / Didn't complete – a failed movement never sits under a success header · rejected counts as failed, cancelled stays neutral · crypto signed, fiat shown unsigned as the gross converted amount · mount `UnifiedActivityBlock` for the full feed, `ActivityBlock` for transfers only |

## Verify

```bash
npm install
npm run typecheck && npm test    # contract invariants as executable tests
npx tsx demo/render.tsx          # writes demo/out/index.html – the composed proof page
```

The demo page composes the core components into a payments screen plus a greyscale strip that demonstrates the legibility contract.

For the kit running against live hooks, see [`examples/mock-bank`](../examples/mock-bank/): a full account experience in mock mode – `npm install && npm run dev`, fake data, zero credentials.

## Mobile

The kit is mobile-primary. `tokens.css` carries the only `@media` query: below `40rem` the panel, card and form clamps become `100%` so a 375px viewport never grows a horizontal body scrollbar. Tables sit in `.venly-table-scroll` and scroll inside that container; field-list rows and the send amount split stack.

`--focus-ring` and `:focus-visible` live in the same file so every button, input, select, tab and row shows a visible cursor under keyboard focus.

## Styling approach

Components use inline styles bound to the token variables rather than a utility framework. That keeps the kit runnable in any React stack (Tailwind or not), keeps the measured ratios exact, and keeps `tokens.css` the single source of visual truth. Consumers who want utility-class styling own the files and can convert them – that is the point of copy-owned distribution.

MIT. Part of the [venly-settlement-sdk](https://github.com/Venly/venly-settlement-sdk) monorepo, alongside [`@venlyfinance/sdk`](../README.md), [`@venlyfinance/react`](../react/README.md) and [`@venlyfinance/settlement-mcp`](../settlement-mcp/README.md).

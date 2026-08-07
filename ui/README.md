# @venlyfinance/ui

Copy-owned UI kit for money products built on `@venlyfinance/react`. Not an npm package: these files are meant to land in your repo (shadcn-registry distribution is the delivery mechanism), where you own and restyle them.

## The white-label contract

[`registry/styles/tokens.css`](registry/styles/tokens.css) is the reskin surface – **a reskin must be that file and nothing else**. Every component reads exclusively from its custom properties; no component carries a raw colour, radius, or size at the call site.

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

## Verify

```bash
npm install
npm run typecheck && npm test    # contract invariants as executable tests
npx tsx demo/render.tsx          # writes demo/out/index.html – the composed proof page
```

The demo page composes all five components into a payments screen plus a greyscale strip that demonstrates the legibility contract.

## Styling approach

Components use inline styles bound to the token variables rather than a utility framework. That keeps the kit runnable in any React stack (Tailwind or not), keeps the measured ratios exact, and keeps `tokens.css` the single source of visual truth. Consumers who want utility-class styling own the files and can convert them – that is the point of copy-owned distribution.

MIT. Part of the [venly-settlement-sdk](https://github.com/Venly/venly-settlement-sdk) monorepo.

import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { VenlyProvider, useAccounts } from "@venlyfinance/react";
import "../../../ui/registry/styles/tokens.css";
import { BalancesBlock, BalanceMiniature } from "../../../ui/registry/blocks/balances.js";
import { ConnectedReceiveBlock } from "../../../ui/registry/blocks/receive.js";
import { SendBlock } from "../../../ui/registry/blocks/send.js";
import { ActivityBlock, type ActivityScope } from "../../../ui/registry/blocks/activity.js";

type Tab = "home" | "activity" | "send" | "receive";

function Shell() {
  const { data } = useAccounts();
  const account = data?.items[0];
  const [tab, setTab] = useState<Tab>("home");
  const [toast, setToast] = useState<string | null>(null);
  // Masking is a surface-wide contract: the shell owns it so the hero,
  // the per-asset rows AND the rail miniature hide together.
  const [masked, setMasked] = useState(false);
  const [activityScope, setActivityScope] = useState<ActivityScope>("all");

  if (!account?.id) {
    return <p style={{ fontFamily: "var(--font-family)", color: "var(--text-tertiary)", padding: 32 }}>Loading…</p>;
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--surface-page)",
        fontFamily: "var(--font-family)",
        display: "flex",
      }}
    >
      <nav
        style={{
          width: 200,
          flex: "none",
          borderRight: "var(--border-w-hairline) solid var(--border-hairline)",
          padding: "var(--space-xl) var(--space-md)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-2xs)",
        }}
      >
        <div
          style={{
            fontWeight: 600,
            fontSize: "var(--font-size-body)",
            color: "var(--text-primary)",
            padding: "0 var(--space-md) var(--space-lg)",
          }}
        >
          Mock Bank
        </div>
        {(["home", "activity", "send", "receive"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => {
              if (t === "activity") setActivityScope("all");
              setTab(t);
            }}
            style={{
              textAlign: "left",
              border: "none",
              cursor: "pointer",
              borderRadius: "var(--radius-control)",
              padding: "var(--space-sm) var(--space-md)",
              fontSize: "var(--font-size-body)",
              fontWeight: tab === t ? 600 : 400,
              color: tab === t ? "var(--text-primary)" : "var(--text-secondary)",
              background: tab === t ? "var(--selected-tint)" : "transparent",
              textTransform: "capitalize",
            }}
          >
            {t}
          </button>
        ))}
        {/* Persistent miniature: the primary available figure echoed in the
            chrome, sharing the surface's masked state. */}
        <div style={{ marginTop: "auto", padding: "var(--space-md)" }}>
          <BalanceMiniature accountId={account.id} masked={masked} />
        </div>
      </nav>

      <main style={{ flex: 1, padding: "var(--space-2xl)", minWidth: 0 }}>
        <h1
          style={{
            fontSize: "var(--font-size-title)",
            fontWeight: 600,
            color: "var(--text-primary)",
            margin: "0 0 var(--space-xl)",
            textTransform: "capitalize",
          }}
        >
          {tab}
        </h1>

        {tab === "home" ? (
          <BalancesBlock
            accountId={account.id}
            qualifier={account.name ?? account.id}
            masked={masked}
            onToggleMasked={() => setMasked((m) => !m)}
            onReservedDrill={() => {
              setActivityScope("pending");
              setTab("activity");
            }}
          />
        ) : null}
        {tab === "activity" ? (
          <ActivityBlock key={activityScope} accountId={account.id} initialScope={activityScope} />
        ) : null}
        {tab === "send" ? <SendBlock senderAccountId={account.id} /> : null}
        {tab === "receive" ? (
          <ConnectedReceiveBlock
            accountId={account.id}
            onCopied={(field) => {
              setToast(`You copied ${field.toLowerCase() === "all payment details" ? field : `your ${field.toLowerCase()}`}`);
              setTimeout(() => setToast(null), 2500);
            }}
          />
        ) : null}

        {toast ? (
          <div
            role="status"
            style={{
              position: "fixed",
              bottom: "var(--space-2xl)",
              left: "50%",
              transform: "translateX(-50%)",
              background: "var(--accent)",
              color: "var(--accent-fg)",
              borderRadius: "var(--radius-control)",
              padding: "var(--space-sm) var(--space-lg)",
              fontSize: "var(--font-size-body)",
              boxShadow: "var(--shadow-overlay)",
            }}
          >
            {toast}
          </div>
        ) : null}
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <VenlyProvider environment="mock">
      <Shell />
    </VenlyProvider>
  </StrictMode>,
);

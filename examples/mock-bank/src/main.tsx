import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { VenlyProvider, useAccounts } from "@venlyfinance/react";
import "../../../ui/registry/styles/tokens.css";
import { BalanceCard } from "../../../ui/registry/components/balance-card.js";
import { ConnectedReceiveBlock } from "../../../ui/registry/blocks/receive.js";
import { SendBlock } from "../../../ui/registry/blocks/send.js";
import { ActivityBlock } from "../../../ui/registry/blocks/activity.js";

type Tab = "activity" | "send" | "receive";

function Shell() {
  const { data } = useAccounts();
  const account = data?.items[0];
  const [tab, setTab] = useState<Tab>("activity");
  const [toast, setToast] = useState<string | null>(null);

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
        {(["activity", "send", "receive"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
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

        <div style={{ marginBottom: "var(--space-2xl)" }}>
          <BalanceCard
            label="Available"
            available={15100.5}
            currency="EUR"
            qualifier={account.name ?? account.id}
            buckets={[
              { label: "Total", amount: 15230.5 },
              { label: "Reserved out", amount: 130, locked: true },
            ]}
          />
        </div>

        {tab === "activity" ? <ActivityBlock accountId={account.id} /> : null}
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

import { ReactElement, useMemo, useState, useCallback } from "react";
import type {
  Account,
  VirtualBankAccount,
} from "@venlyfinance/sdk";
import {
  useAccount,
  useVirtualBankAccounts,
  useCreateVirtualBankAccount,
} from "@venlyfinance/react";
import { FieldList } from "../components/field-list.js";
import { StatusPill } from "../components/status-pill.js";
import { ListLoadError } from "../components/list-error.js";
import { formatStamp } from "../lib/money.js";

// ─── Constants ───────────────────────────────────────────────────────────────

const REFERENCE_WARNING =
   "Enter the payment reference exactly as shown. If it is missing or changed, the payment cannot be matched automatically and may require manual reconciliation. If your bank cannot accept the reference exactly as shown, stop and contact the recipient before sending.";

const FRAUD_CHECK_ADVISORY =
   "If these details differ from instructions you used before, confirm the change with the recipient through a trusted channel before sending.";

const CURRENCY_DISPLAY: Record<string, string> = {
  EUR_SEPA: "SEPA",
};

// ─── Serializer ──────────────────────────────────────────────────────────────

export interface ReceiveDetails {
  name: string;
  iban: string;
  bic: string;
  bankName: string;
  beneficiaryName: string;
  referenceCode: string;
  currency: string;
  bankAccountType: string;
  targetCryptocurrency?: string;
}

export function serializeReceiveDetails(details: ReceiveDetails): string {
  const lines: string[] = [];
  const now = new Date();
  lines.push("Bank transfer instructions");
  lines.push(`Generated: ${formatStamp(now)}`);
  lines.push("");
  lines.push("Important");
  lines.push(REFERENCE_WARNING);
  lines.push("");
  lines.push("Payment reference (required)");
  lines.push(details.referenceCode);
  lines.push(details.beneficiaryName);
  lines.push(details.iban);
  lines.push(details.bic);
  lines.push(details.bankName);
  lines.push(`Currency to send: ${details.currency}`);
  lines.push(
     `Transfer type: ${
      CURRENCY_DISPLAY[details.bankAccountType] ?? "SEPA"
     } bank transfer`
   );
  lines.push("");
  lines.push("Currency conversion");
  lines.push(
    details.targetCryptocurrency
       ? `Send ${details.currency}, not ${details.targetCryptocurrency}. The recipient account converts incoming ${details.currency} to ${details.targetCryptocurrency}.`
       : `Send ${details.currency}. (No conversion takes place.)`
   );
  lines.push("");
  lines.push("Fraud check");
  lines.push(FRAUD_CHECK_ADVISORY);
  return lines.join("\n");
}

// ─── Clipboard helper ───────────────────────────────────────────────────────

export async function copyText(value: string): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.clipboard) return false;
  try {
    await navigator.clipboard.writeText(value);
    return true;
   } catch {
    return false;
   }
}

// ─── PDF adapter (dependency-light) ──────────────────────────────────────────

function sanitizeFileName(base: string): string {
  return base.replace(/[^\w]/g, "_").slice(0, 40).toLowerCase();
}

export function downloadPDF(
  details: ReceiveDetails,
  name: string,
  generateClock: () => string = () => new Date().toLocaleString()
): void {
  const now = generateClock();
  const dateStr =
    name && name.trim().length > 0
       ? `${sanitizeFileName(name)}-${now.split(",")[0].replace(/\//g, "-").replace(/ /g, "-")}`
       : now.split(",")[0].replace(/\//g, "-").replace(/ /g, "-");
  void dateStr;
  const html = `<!doctype html>
<html><head><title>Bank transfer instructions</title>
<style>body{font-family:sans-serif;padding:48px;max-width:600px}
h1{font-size:18px;margin-bottom:8px}h2{font-size:14px;margin-top:24px;margin-bottom:4px}
p{margin:4px 0;font-size:13px;line-height:1.4}table{width:100%;border-collapse:collapse;margin:8px 0}
td,th{text-align:left;padding:4px 0;font-size:13px;border-bottom:1px solid lightgray}
th{width:140px}</style></head><body>
<h1>Bank transfer instructions</h1>
<p>Generated: ${now}</p>
<h2>Important</h2>
<p>${REFERENCE_WARNING}</p>
<table>
<tr><th>Payment reference</th><td><strong>${details.referenceCode}</strong><br/><span style="font-size:11px">(required)</span></td></tr>
<tr><td>Beneficiary name</td><td>${details.beneficiaryName}</td></tr>
<tr><td>IBAN</td><td><strong>${details.iban}</strong></td></tr>
<tr><td>BIC / SWIFT code</td><td><strong>${details.bic}</strong></td></tr>
<tr><td>Bank name</td><td>${details.bankName}</td></tr>
<tr><td>Currency to send</td><td>${details.currency}</td></tr>
<tr><td>Transfer type</td><td>${CURRENCY_DISPLAY[details.bankAccountType] ?? "SEPA"} bank transfer</td></tr>
</table>
<h2>Currency conversion</h2>
<p>${details.targetCryptocurrency ? `Send ${details.currency}, not ${details.targetCryptocurrency}. The recipient account converts incoming ${details.currency} to ${details.targetCryptocurrency}.` : `Send ${details.currency}. (No conversion takes place.)`}</p>
<h2>Fraud check</h2>
<p>${FRAUD_CHECK_ADVISORY}</p>
</body></html>`;

  const win = window.open("", "_blank");
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => {
    win.print();
    setTimeout(() => win.close(), 2000);
   }, 300);
}

// ─── Completeness helper ────────────────────────────────────────────────────

const REQUIRED_FIELDS: (keyof VirtualBankAccount)[] = [
   "referenceCode",
   "beneficiaryName",
   "iban",
   "bic",
   "bankName",
   "currency",
   "bankAccountType",
   "targetCryptocurrency",
];

export function isComplete(vba: VirtualBankAccount): boolean {
  return REQUIRED_FIELDS.every((k) => {
    const v = vba[k];
    return v !== undefined && v !== null && v !== "";
   });
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface VbaListResponse {
  items: (VirtualBankAccount | null)[];
  pagination?: {
    pageNumber?: number;
    numberOfElements?: number;
    numberOfPages?: number;
    hasNextPage?: boolean;
    hasPreviousPage?: boolean;
   };
}

// ─── Connected component ────────────────────────────────────────────────────

/**
 * Data-bound entry point for /receive.
 *
 * Flow:
 *    1. Load account (kycStatus), load VBA list (paginated).
 *    2. Route to checklist / provision form / detail / picker.
 */
export function ReceiveBlock({
  accountId,
}: {
  accountId: string;
}): ReactElement | null {
   // ── Account ─────────────────────────────────────────────────────────────
  const {
    data: accountData,
    isLoading: accountLoading,
  } = useAccount(accountId);

   // React-query-v6 shape: { result, status }
  const account = useMemo(() => {
    if (!accountData || typeof accountData !== "object") return null;
    return "result" in accountData
       ? (accountData.result as Account | undefined)
       : (accountData as unknown as Account);
   }, [accountData]);

   // ── VBA list ────────────────────────────────────────────────────────────
  const vbaQuery = useVirtualBankAccounts(accountId);
  const vbaRaw = useMemo(() => {
    if (!vbaQuery.data) return { items: [], pagination: null };
    const d = vbaQuery.data as VbaListResponse;
    return {
      items: d.items.filter((i): i is VirtualBankAccount => i != null),
      pagination: d.pagination ?? null,
     };
   }, [vbaQuery.data]);

   // ── Compute derived state ───────────────────────────────────────────────
  const validItems = useMemo(
     () => vbaRaw.items.filter((v) => v.id && v.status === "ACTIVE"),
     [vbaRaw.items]
   );

   /** CLOSED details still exist and must be shown as closed, never hidden. */
  const closedItems = useMemo(
     () => vbaRaw.items.filter((v) => v.id && v.status === "CLOSED"),
     [vbaRaw.items]
   );


  const autoSelectSingle =
    vbaRaw.pagination &&
    vbaRaw.pagination.numberOfPages === 1 &&
    vbaRaw.pagination.numberOfElements === 1 &&
    validItems.length === 1;

   // ── Provision mutation ──────────────────────────────────────────────────
  const createMutation = useCreateVirtualBankAccount();

   // ── Derive page ─────────────────────────────────────────────────────────

   // Loading
  if (accountLoading || vbaQuery.isLoading) {
    return (
       <section style={{ fontFamily: "var(--font-family)" }}>
         <p style={{ color: "var(--text-tertiary)" }}>
          Loading bank details...
         </p>
       </section>
     );
   }

  // A failed or malformed list (resultPresent === false) is an error, never
  // an empty register: rendering it empty offers "set up bank details" to an
  // account that may already hold them.
  if (
    vbaQuery.isError ||
    !vbaQuery.data ||
    (vbaQuery.data as VbaListResponse & { resultPresent?: boolean }).resultPresent === false
  ) {
    return <ListLoadError what="your bank details" onRetry={() => void vbaQuery.refetch()} />;
  }

   // Sparse account: no kycStatus at all
  if (!account?.kycStatus) {
    return (
       <section style={{ fontFamily: "var(--font-family)" }}>
         <p style={{ color: "var(--text-secondary)", fontStyle: "italic" }}>
          Account status unavailable
         </p>
         <p style={{ color: "var(--text-tertiary)" }}>
          Bank details can't be created or shared until the account status is
          available.
         </p>
       </section>
     );
   }

   // ── VERIFICATION_PENDING or REJECTED ────────────────────────────────────
  if (
    account.kycStatus === "VERIFICATION_PENDING" ||
    account.kycStatus === "REJECTED"
   ) {
    return (
       <AccountInfoPage
        account={account}
        vbaList={vbaRaw.items}
        createMutation={createMutation}
       />
     );
   }

   // ── VERIFIED ────────────────────────────────────────────────────────────
   // No ACTIVE VBA, but a CLOSED one exists → the closed surface, never the
   // provision form. Offering "set up bank details" to an account that holds
   // closed details hides the do-not-use warning the contract requires.
  if (validItems.length === 0 && closedItems.length > 0) {
    return <DetailPage vba={closedItems[0]} account={account} onRefresh={() => void vbaQuery.refetch()} />;
   }

   // No VBA at all → provisioning
  if (validItems.length === 0) {
    return (
       <ProvisionForm
        accountId={accountId}
        createMutation={createMutation}
        onError={() => {}}
        onCreated={() => void vbaQuery.refetch()}
       />
     );
   }

   // Auto-select single → single detail
  if (autoSelectSingle) {
    return (
       <DetailPage vba={validItems[0]} account={account} onRefresh={() => void vbaQuery.refetch()} />
      );
   }

   // Multiple valid → picker
  return (
     <PickerPage
      account={account}
      vbaList={vbaRaw.items}
     />
   );
}

// ─── Single-detail page (VERIFIED + active VBA) ─────────────────────────────

interface DetailPageProps {
  vba: VirtualBankAccount;
  account: Account;
  onRefresh?: () => void;
}

function DetailPage({ vba, account, onRefresh }: DetailPageProps): ReactElement {
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);

  const complete = isComplete(vba);

   // Per-field copy
  const handleFieldCopy = useCallback(
    async (label: string, value: string): Promise<void> => {
      if (!complete) {
        setCopyError(
           `${label} wasn't copied. Select and copy the value manually, or try again.`
         );
        return;
       }
      const ok = await copyText(value);
      if (ok) {
        setCopiedField(`${label} copied.`);
        setTimeout(() => setCopiedField(null), 1500);
       }
     },
     [complete]
   );

   // Whole-set text copy
  const handleCopyAll = useCallback(async (): Promise<void> => {
    if (!complete) {
      setCopyError(
         "Bank transfer details weren't copied. Try again or download the PDF."
       );
      return;
     }
    const details: ReceiveDetails = {
      name: account.name ?? "Unnamed bank details",
      iban: vba.iban ?? "",
      bic: vba.bic ?? "",
      bankName: vba.bankName ?? "",
      beneficiaryName: vba.beneficiaryName ?? "",
      referenceCode: vba.referenceCode ?? "",
      currency: vba.currency ?? "",
      bankAccountType: vba.bankAccountType ?? "",
      targetCryptocurrency: vba.targetCryptocurrency ?? undefined,
     };
    const ok = await copyText(serializeReceiveDetails(details));
    if (ok) setCopiedField("Bank transfer details copied.");
    else
      setCopyError(
         "Bank transfer details weren't copied. Try again or download the PDF."
       );
    setTimeout(() => setCopiedField(null), 2000);
   }, [complete, account, vba]);

   // PDF download
  const handleDownloadPDF = useCallback((): void => {
    if (!complete) {
      setCopyError(
         "The PDF wasn't created. Try again or copy the details as text."
       );
      return;
     }
    const details: ReceiveDetails = {
      name: account.name ?? "Unnamed bank details",
      iban: vba.iban ?? "",
      bic: vba.bic ?? "",
      bankName: vba.bankName ?? "",
      beneficiaryName: vba.beneficiaryName ?? "",
      referenceCode: vba.referenceCode ?? "",
      currency: vba.currency ?? "",
      bankAccountType: vba.bankAccountType ?? "",
      targetCryptocurrency: vba.targetCryptocurrency ?? undefined,
     };
    downloadPDF(details, account.name ?? "Unnamed bank details");
   }, [complete, account, vba]);

   // ── VBA has status CLOSED ───────────────────────────────────────────────
  if (vba.status === "CLOSED") {
    return (
       <ClosedPage account={account} />
     );
   }

   // ── VBA ACTIVE and complete: the happy path ───────────────────────────────
  if (complete) {
    return (
       <ShareSection
        accountName={account.name ?? "Unnamed bank details"}
        onCopyAll={handleCopyAll}
        onDownloadPDF={handleDownloadPDF}
        copiedField={copiedField}
        copyError={copyError}
       >
         <FieldList
          fields={[
             {
              label: "Payment reference",
              value: vba.referenceCode ?? "",
              mono: true,
              required: true,
             },
             { label: "Beneficiary name", value: vba.beneficiaryName ?? "" },
             { label: "IBAN", value: vba.iban ?? "", mono: true },
             {
              label: "BIC / SWIFT code",
              value: vba.bic ?? "",
              mono: true,
             },
             {
              label: "Bank name",
              value: vba.bankName ?? "",
              copyable: false,
             },
             {
              label: "Currency to send",
              value: vba.currency ?? "",
             },
             {
              label: "Transfer type",
              value: `${CURRENCY_DISPLAY[vba.bankAccountType ?? ""] ?? "SEPA"} bank transfer`,
              copyable: false,
             },
           ]}
          onCopy={handleFieldCopy}
         />
         {vba.targetCryptocurrency ? (
           <div style={{ marginTop: "var(--space-md)" }}>
             <p
              style={{
                fontSize: "var(--font-size-micro)",
                color: "var(--text-secondary)",
                fontStyle: "italic",
               }}
             >
              Send {vba.currency}, not {vba.targetCryptocurrency}. The
              recipient account converts incoming {vba.currency} to{" "}
               {vba.targetCryptocurrency}.
             </p>
           </div>
         ) : null}
       </ShareSection>
     );
   }

   // ── VBA ACTIVE but incomplete ────────────────────────────────────────────
  return (
     <BlockedSection
      copyError={copyError}
      setCopyError={setCopyError}
     >
       {/*
        * The completeness gate: when ANY serializer input is absent, EVERY copy
        * path is closed - per-field included. A partially-copied instruction set
        * is the failure mode this journey exists to prevent, so no row is
        * copyable here and no onCopy handler is wired.
        */}
       <FieldList
        fields={[
           {
            label: "Payment reference",
            value: vba.referenceCode ?? "Unavailable",
            mono: true,
            required: true,
            copyable: false,
           },
           {
            label: "Beneficiary name",
            value: vba.beneficiaryName ?? "Unavailable",
            copyable: false,
           },
           {
            label: "IBAN",
            value: vba.iban ?? "Unavailable",
            mono: true,
            copyable: false,
           },
           {
            label: "BIC / SWIFT code",
            value: vba.bic ?? "Unavailable",
            mono: true,
            copyable: false,
           },
           {
            label: "Bank name",
            value: vba.bankName ?? "Unavailable",
            copyable: false,
           },
           {
            label: "Currency to send",
            value: vba.currency ?? "Unavailable",
            copyable: false,
           },
           {
            label: "Transfer type",
            value: `${CURRENCY_DISPLAY[vba.bankAccountType ?? "EUR_SEPA"] ?? "SEPA"} bank transfer`,
            copyable: false,
           },
         ]}
       />
{onRefresh && (
        <div style={{ marginTop: "var(--space-sm)" }}>
          <button
           type="button"
           onClick={onRefresh}
           style={{
             border: "none",
             background: "none",
             color: "var(--text-secondary)",
             cursor: "pointer",
             fontSize: "var(--font-size-label)",
             textDecoration: "underline",
            }}
          >
           Reload bank details
          </button>
        </div>
)}
     </BlockedSection>
   );
}

// ─── AccountInfoPage: verification-pending / rejected ─────────────────────────

function AccountInfoPage({
  account,
  vbaList,
  createMutation,
}: {
  account: Account;
  vbaList: (VirtualBankAccount | null)[];
  createMutation: ReturnType<typeof useCreateVirtualBankAccount>;
}): ReactElement {
  void vbaList;
  void createMutation;
  const isPending = account.kycStatus === "VERIFICATION_PENDING";
  const isRejected = account.kycStatus === "REJECTED";

  return (
     <section style={{ fontFamily: "var(--font-family)" }}>
       {isPending ? (
         <>
           <h2
            style={{
              fontSize: "var(--font-size-value)",
              fontWeight: 600,
              color: "var(--text-primary)",
             }}
           >
            Bank details aren't available yet.
           </h2>
           <p style={{ color: "var(--text-secondary)" }}>
            Account verification is in review. No completion estimate is
            available here. Open{" "}
             <a
              href="/onboarding/status"
              style={{ color: "var(--accent)", cursor: "pointer" }}
             >
              Verification status
             </a>{" "}
            to see whether any action is required. Bank details can be created
            after verification is complete. You can continue to view this
            account; other sections show their own availability.
           </p>
           <table
            style={{
              width: "100%",
              marginTop: "var(--space-md)",
              borderCollapse: "collapse",
             }}
           >
             <tbody>
               <tr>
                 <td
                  style={{
                    fontSize: "var(--font-size-label)",
                    color: "var(--text-secondary)",
                   }}
                 >
                  Account selected
                 </td>
                 <td
                  style={{
                    fontSize: "var(--font-size-label)",
                    color: "var(--text-primary)",
                   }}
                 >
                  Complete
                 </td>
               </tr>
               <tr>
                 <td
                  style={{
                    fontSize: "var(--font-size-label)",
                    color: "var(--text-secondary)",
                   }}
                 >
                  Account verification
                 </td>
                 <td
                  style={{
                    fontSize: "var(--font-size-label)",
                    color: "var(--state-pending-fg)",
                   }}
                 >
                  In review
                 </td>
               </tr>
               <tr>
                 <td
                  style={{
                    fontSize: "var(--font-size-label)",
                    color: "var(--text-secondary)",
                   }}
                 >
                  Bank details
                 </td>
                 <td
                  style={{
                    fontSize: "var(--font-size-label)",
                    color: "var(--text-tertiary)",
                   }}
                 >
                  Not available
                 </td>
               </tr>
             </tbody>
           </table>
         </>
       ) : isRejected ? (
         <>
           <h2
            style={{
              fontSize: "var(--font-size-value)",
              fontWeight: 600,
              color: "var(--text-primary)",
             }}
           >
            Bank details are unavailable.
           </h2>
           <p style={{ color: "var(--text-secondary)" }}>
            Account verification was declined, so bank details cannot be
            created.
           </p>
           <table
            style={{
              width: "100%",
              marginTop: "var(--space-md)",
              borderCollapse: "collapse",
             }}
           >
             <tbody>
               <tr>
                 <td
                  style={{
                    fontSize: "var(--font-size-label)",
                    color: "var(--text-secondary)",
                   }}
                 >
                  Account selected
                 </td>
                 <td
                  style={{
                    fontSize: "var(--font-size-label)",
                    color: "var(--text-primary)",
                   }}
                 >
                  Complete
                 </td>
               </tr>
               <tr>
                 <td
                  style={{
                    fontSize: "var(--font-size-label)",
                    color: "var(--text-secondary)",
                   }}
                 >
                  Account verification
                 </td>
                 <td
                  style={{
                    fontSize: "var(--font-size-label)",
                    color: "var(--state-danger-fg)",
                   }}
                 >
                  Declined
                 </td>
               </tr>
               <tr>
                 <td
                  style={{
                    fontSize: "var(--font-size-label)",
                    color: "var(--text-secondary)",
                   }}
                 >
                  Bank details
                 </td>
                 <td
                  style={{
                    fontSize: "var(--font-size-label)",
                    color: "var(--text-tertiary)",
                   }}
                 >
                  Not available
                 </td>
               </tr>
             </tbody>
           </table>
           <p style={{ marginTop: "var(--space-sm)" }}>
             <a
              href="/onboarding/status"
              style={{ color: "var(--accent)", cursor: "pointer" }}
             >
              View verification status
             </a>
           </p>
         </>
       ) : null}
     </section>
   );
}

// ─── Provision form (VERIFIED, no VBA) ───────────────────────────────────────

function ProvisionForm({
  accountId,
  createMutation,
  onError,
  onCreated,
}: {
  accountId: string;
  createMutation: ReturnType<typeof useCreateVirtualBankAccount>;
  onError?: (msg: string) => void;
  onCreated?: () => void;
}): ReactElement {
  const [name, setName] = useState("");
  const [crypto, setCrypto] = useState("USDC");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async (): Promise<void> => {
    if (!name.trim()) {
      const msg = "Check the highlighted fields.";
      setError(msg);
      onError?.(msg);
      return;
     }
    setCreating(true);
    setError(null);
    try {
      const idempotencyKey = `venly-provision-${accountId}-${name.trim()}-${Date.now()}`;
      await createMutation.mutateAsync({
        accountId,
        body: {
          name: name.trim(),
          inCurrency: "EUR",
          targetCryptocurrency: crypto,
          idempotencyKey,
         },
       });
       // On success, call onCreated so the parent refetches vbaQuery and renders the
       // newly created VBA in place — no full page reload (which would drop the session).
      onCreated?.();
     } catch (_err) {
      const msg = "Bank details weren't created. Try again.";
      setError(msg);
      onError?.(msg);
     } finally {
      setCreating(false);
     }
   };

  return (
     <section style={{ fontFamily: "var(--font-family)" }}>
       <h2
        style={{
          fontSize: "var(--font-size-value)",
          fontWeight: 600,
          color: "var(--text-primary)",
         }}
       >
        Set up bank details
       </h2>
       <p style={{ color: "var(--text-secondary)" }}>
        Create EUR SEPA bank-transfer details for this account.
       </p>

       <div style={{ marginTop: "var(--space-md)" }}>
         <label
          style={{
            display: "block",
            fontSize: "var(--font-size-label)",
            color: "var(--text-secondary)",
           }}
         >
          Bank details name
         </label>
         <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{
            width: "100%",
            padding: "var(--space-sm)",
            fontSize: "var(--font-size-body)",
            fontFamily: "var(--font-family)",
            border:
               "var(--border-w-hairline) solid var(--border-strong)",
            borderRadius: "var(--radius-control)",
            outline: "none",
           }}
          placeholder="My EUR Deposit Account"
         />
       </div>

       <div style={{ marginTop: "var(--space-md)" }}>
         <p style={{ color: "var(--text-secondary)" }}>
          Payer sends: EUR via SEPA
         </p>
       </div>

       <div style={{ marginTop: "var(--space-md)" }}>
         <label
          style={{
            display: "block",
            fontSize: "var(--font-size-label)",
            color: "var(--text-secondary)",
           }}
         >
          Convert incoming EUR to
         </label>
         <select
          value={crypto}
          onChange={(e) => setCrypto(e.target.value)}
          style={{
            width: "100%",
            padding: "var(--space-sm)",
            fontSize: "var(--font-size-body)",
            fontFamily: "var(--font-family)",
            border:
               "var(--border-w-hairline) solid var(--border-strong)",
            borderRadius: "var(--radius-control)",
           }}
         >
           <option value="USDC">USDC</option>
           <option value="EURC">EURC</option>
           <option value="USDT">USDT</option>
           <option value="USDS">USDS</option>
         </select>
       </div>

       <div style={{ marginTop: "var(--space-md)" }}>
         <button
          type="button"
          onClick={handleCreate}
          disabled={creating}
          style={{
            border: "none",
            background: "var(--accent)",
            color: "var(--accent-fg)",
            borderRadius: "var(--radius-control)",
            padding: "var(--space-sm) var(--space-lg)",
            fontSize: "var(--font-size-label)",
            fontWeight: 500,
            cursor: creating ? "not-allowed" : "pointer",
           }}
         >
           {creating ? "Creating..." : "Create bank details"}
         </button>
       </div>

       {error && (
         <p
          style={{
            color: "var(--text-secondary)",
            fontSize: "var(--font-size-label)",
            marginTop: "var(--space-sm)",
           }}
         >
           {error}
         </p>
       )}
     </section>
   );
}

// ─── Picker page (multiple active VBAs) ──────────────────────────────────────

function PickerPage({
  account: _account,
  vbaList,
}: {
  account: Account;
  vbaList: (VirtualBankAccount | null)[];
}): ReactElement {
  const [selectedId, setSelectedId] = useState<string | null>(null);

   /** Returned by the API but unusable: no id, or no status. */
  const unselectable = useMemo(
     () => vbaList.filter((v): v is VirtualBankAccount => v != null && (!v.id || !v.status)),
     [vbaList]
   );

   // Sort: ACTIVE first, then CLOSED; by name (then id)
  const sorted = useMemo(() => {
    const items = vbaList.filter(
       (v): v is VirtualBankAccount => v != null && !!v.id && !!v.status
     );
    return items.sort((a, b) => {
      if (a.status === "ACTIVE" && b.status !== "ACTIVE") return -1;
      if (a.status !== "ACTIVE" && b.status === "ACTIVE") return 1;
      return (a.name ?? "").localeCompare(b.name ?? "");
     });
   }, [vbaList]);

  const selected = useMemo(
     () => sorted.find((v) => v.id === selectedId) ?? null,
     [sorted, selectedId]
   );

  const activeItems = sorted.filter((v) => v.status === "ACTIVE");
  const closedItems = sorted.filter((v) => v.status === "CLOSED");

   // Derive which to show
  const showItems =
    activeItems.length > 0
       ? activeItems
       : closedItems.length > 0
       ? closedItems
       : [];

  return (
     <section style={{ fontFamily: "var(--font-family)" }}>
       <h2
        style={{
          fontSize: "var(--font-size-value)",
          fontWeight: 600,
          color: "var(--text-primary)",
         }}
       >
        Choose bank details
       </h2>
       <p style={{ color: "var(--text-secondary)" }}>
        Select the bank details you want to share.
       </p>

       {showItems.length === 0 && sorted.length > 0 && (
         <p style={{ color: "var(--text-secondary)", fontStyle: "italic", marginTop: "var(--space-sm)" }}>
          No bank details are available.
         </p>
       )}

       <div style={{ marginTop: "var(--space-sm)" }}>
         <select
          value={selectedId ?? ""}
          onChange={(e) => {
            setSelectedId(e.target.value);
           }}
          style={{
            width: "100%",
            padding: "var(--space-sm)",
            fontSize: "var(--font-size-body)",
            fontFamily: "var(--font-family)",
            border:
               "var(--border-w-hairline) solid var(--border-strong)",
            borderRadius: "var(--radius-control)",
           }}
         >
           <option value="">Select bank details</option>
           {showItems.map((v) => (
             <option key={v.id} value={v.id}>
               {v.name ?? "Unnamed bank details"} —{" "}
               {v.status === "ACTIVE" ? "Active" : "Closed"}
             </option>
           ))}
           {unselectable.map((_v, i) => (
             <option key={`unavailable-${i}`} value="" disabled>
              Bank details unavailable — missing identity or status
             </option>
           ))}
         </select>
       </div>

       {unselectable.length > 0 && (
         <p
          style={{
            color: "var(--text-tertiary)",
            fontSize: "var(--font-size-micro)",
            marginTop: "var(--space-2xs)",
           }}
         >
           {unselectable.length === 1 ? "One entry is" : `${unselectable.length} entries are`}{" "}
          missing identity or status information and can&apos;t be shared.
         </p>
       )}

       {selected && <DetailPage vba={selected} account={_account} />}
     </section>
   );
}

// ─── ShareSection (complete, active) ─────────────────────────────────────────

function ShareSection({
  accountName,
  onCopyAll,
  onDownloadPDF,
  copiedField,
  copyError,
  children,
}: {
  accountName: string;
  onCopyAll: () => void;
  onDownloadPDF: () => void;
  copiedField: string | null;
  copyError: string | null;
  children: React.ReactNode;
}): ReactElement {
  return (
     <section style={{ fontFamily: "var(--font-family)" }}>
       <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: "var(--space-sm)",
         }}
       >
         <span
          style={{
            fontSize: "var(--font-size-value)",
            fontWeight: 600,
            color: "var(--text-primary)",
           }}
         >
           {accountName}
         </span>
       </div>

       <StatusPill label="Bank details status – Active" intent="positive" />

       <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: "var(--space-sm)",
          marginTop: "var(--space-md)",
         }}
       >
         <button
          type="button"
          onClick={onCopyAll}
          style={{
            border:
               "var(--border-w-hairline) solid var(--border-strong)",
            background: "var(--surface-raised)",
            borderRadius: "var(--radius-control)",
            padding: "var(--space-sm) var(--space-lg)",
            fontSize: "var(--font-size-label)",
            fontWeight: 500,
            color: "var(--text-primary)",
            cursor: "pointer",
           }}
         >
           {copiedField?.includes("Bank transfer details")
             ? "Copied!"
             : "Copy details"}
         </button>
         <button
          type="button"
          onClick={onDownloadPDF}
          style={{
            border:
               "var(--border-w-hairline) solid var(--border-strong)",
            background: "var(--surface-raised)",
            borderRadius: "var(--radius-control)",
            padding: "var(--space-sm) var(--space-lg)",
            fontSize: "var(--font-size-label)",
            fontWeight: 500,
            color: "var(--text-primary)",
            cursor: "pointer",
           }}
         >
          Download PDF
         </button>
       </div>

       <p
        style={{
          fontSize: "var(--font-size-label)",
          color: "var(--text-secondary)",
          marginTop: "var(--space-md)",
         }}
       >
        Payer sends: EUR via SEPA
       </p>

       <div role="alert" style={{ marginTop: "var(--space-md)" }}>
         <p
          style={{
            background: "var(--state-pending-bg)",
            color: "var(--state-pending-fg)",
            borderRadius: "var(--radius-control)",
            padding: "var(--space-sm) var(--space-md)",
            fontSize: "var(--font-size-label)",
           }}
         >
           {REFERENCE_WARNING}
         </p>
       </div>

       {children}

       {copiedField && (
         <div
          style={{
            position: "fixed",
            bottom: "var(--space-lg)",
            left: "50%",
            transform: "translateX(-50%)",
            background: "var(--surface-raised)",
            color: "var(--text-primary)",
            borderRadius: "var(--radius-control)",
            padding: "var(--space-sm) var(--space-md)",
            fontSize: "var(--font-size-label)",
            boxShadow: "var(--shadow-overlay)",
            zIndex: 100,
           }}
          role="status"
          aria-live="polite"
         >
           {copiedField}
         </div>
       )}

       {copyError && (
         <div
          style={{
            marginTop: "var(--space-sm)",
            fontSize: "var(--font-size-label)",
            color: "var(--text-secondary)",
           }}
         >
           {copyError}
         </div>
       )}
     </section>
   );
}

// ─── BlockedSection (ACTIVE but incomplete) ───────────────────────────────────

function BlockedSection({
  copyError: _copyError,
  setCopyError: _setCopyError,
  children,
}: {
  copyError: string | null;
  setCopyError: (msg: string | null) => void;
  children: React.ReactNode;
}): ReactElement {
  return (
     <section style={{ fontFamily: "var(--font-family)" }}>
       <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: "var(--space-sm)",
         }}
       >
         <span
          style={{
            fontSize: "var(--font-size-value)",
            fontWeight: 600,
            color: "var(--text-primary)",
           }}
         >
          Bank transfer instructions
         </span>
       </div>

       <StatusPill label="Bank details status – Active" intent="positive" />

       <div
        role="alert"
        style={{
          background: "var(--state-pending-bg)",
          color: "var(--state-pending-fg)",
          borderRadius: "var(--radius-control)",
          padding: "var(--space-sm) var(--space-md)",
          fontSize: "var(--font-size-label)",
          marginTop: "var(--space-sm)",
         }}
       >
         <strong>Bank transfer instructions are incomplete.</strong>
         <p style={{ margin: "var(--space-sm) 0 0" }}>
          One or more required fields are unavailable. Copying and download
          are disabled so incomplete instructions cannot be sent.
         </p>
       </div>

       <div
        style={{
          display: "flex",
          gap: "var(--space-sm)",
          marginTop: "var(--space-md)",
         }}
       >
         <button
          type="button"
          disabled
          style={{
            border:
               "var(--border-w-hairline) solid var(--border-strong)",
            background: "var(--surface-raised)",
            borderRadius: "var(--radius-control)",
            padding: "var(--space-sm) var(--space-lg)",
            fontSize: "var(--font-size-label)",
            fontWeight: 500,
            color: "var(--text-tertiary)",
            cursor: "not-allowed",
           }}
         >
          Copy details
         </button>
         <button
          type="button"
          disabled
          style={{
            border:
               "var(--border-w-hairline) solid var(--border-strong)",
            background: "var(--surface-raised)",
            borderRadius: "var(--radius-control)",
            padding: "var(--space-sm) var(--space-lg)",
            fontSize: "var(--font-size-label)",
            fontWeight: 500,
            color: "var(--text-tertiary)",
            cursor: "not-allowed",
           }}
         >
          Download PDF
         </button>
       </div>

       {children}
     </section>
   );
}

// ─── Closed page ─────────────────────────────────────────────────────────────

function ClosedPage({
  account,
}: {
  account: Account;
}): ReactElement {
  void account;
  return (
     <section style={{ fontFamily: "var(--font-family)" }}>
       <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: "var(--space-sm)",
         }}
       >
         <span
          style={{
            fontSize: "var(--font-size-value)",
            fontWeight: 600,
            color: "var(--text-primary)",
           }}
         >
           {account.name ?? "Unnamed bank details"}
         </span>
       </div>

       <StatusPill label="Bank details status – Closed" intent="negative" />

       <p
        style={{
          color: "var(--text-secondary)",
          fontStyle: "italic",
          marginTop: "var(--space-sm)",
         }}
       >
        Closed
       </p>
       <p style={{ color: "var(--text-secondary)" }}>
        These bank details are closed. Do not share or use them for a new
        transfer.
       </p>
     </section>
   );
}

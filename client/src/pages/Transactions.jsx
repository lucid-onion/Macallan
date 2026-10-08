/* ==========================================================================
   Transactions.jsx — the cash ledger and party balances.
     - Company Balance card (Money In / Out / to Collect / to Pay).
     - Suppliers grid  — one box per supplier: Bill / Advance / Due.
     - Customers grid  — one box per customer: Bill / Advance / Due.
     - Recent Transactions — every payment in/out, clickable, with Print.
   ========================================================================== */
import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import {
  Button, Modal, Field, ConfirmDialog, Badge, PageHeader,
  inputCls, selectCls,
} from "../components/ui";
import DataTable from "../components/DataTable";
import { printVoucher } from "../lib/printVoucher";
import { bsToday, formatBs } from "../lib/nepali-date";

/* ---------------- Constants ---------------- */

const TRANSACTION_TYPES = [
  { id: "sale_payment",     label: "Sale Payment — received from a customer",         partyType: "customer", direction: "in",  refType: "sale" },
  { id: "purchase_payment", label: "Purchase Payment — paid to a supplier",           partyType: "supplier", direction: "out", refType: "purchase" },
  { id: "advance_given",    label: "Advance Given — paid ahead to a supplier",        partyType: "supplier", direction: "out", refType: "manual" },
  { id: "advance_received", label: "Advance Received — taken ahead from a party",     partyType: "customer", direction: "in",  refType: "manual" },
  { id: "owner_deposit",    label: "Owner Deposit — capital put into the business",   partyType: "owner",    direction: "in",  refType: "manual" },
  { id: "owner_withdrawal", label: "Owner Withdrawal — capital taken out",            partyType: "owner",    direction: "out", refType: "manual" },
  { id: "other_credit",     label: "Other Credit — money in",                         partyType: "other",    direction: "in",  refType: "manual" },
  { id: "other_debit",      label: "Other Debit — money out",                         partyType: "other",    direction: "out", refType: "manual" },
];

const num = (v) => { const n = Number(v); return isFinite(n) ? n : 0; };
const rupees = (v) => `Rs. ${num(v).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
);

function metaForPayment(p) {
  const direct = TRANSACTION_TYPES.find((t) => t.id === p.type);
  if (direct) return direct;
  if (p.ref_type === "sale") return TRANSACTION_TYPES.find((t) => t.id === "sale_payment");
  if (p.ref_type === "purchase") return TRANSACTION_TYPES.find((t) => t.id === "purchase_payment");
  if (p.party_type === "owner") return TRANSACTION_TYPES.find((t) => t.id === (p.direction === "in" ? "owner_deposit" : "owner_withdrawal"));
  return TRANSACTION_TYPES.find((t) => t.id === (p.direction === "in" ? "other_credit" : "other_debit"));
}

export default function Transactions() {
  const { has, canDelete } = useAuth();
  const canCreate = has("transactions", "create");
  const canDel    = canDelete("transactions");

  const [rows, setRows] = useState([]);
  const [balances, setBalances] = useState({ customers: [], suppliers: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [directionFilter, setDirectionFilter] = useState("");
  const [methodFilter, setMethodFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");

  const [detail, setDetail] = useState(null);
  const [breakdown, setBreakdown] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);

  const [toDelete, setToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  async function load() {
    setLoading(true); setError(null);
    try {
      const [t, pb] = await Promise.all([
        api.get("/api/transactions"),
        api.get("/api/transactions/party-balances"),
      ]);
      setRows(t.items || []);
      setBalances({
        customers: pb.customers || [],
        suppliers: pb.suppliers || [],
      });
    } catch (e) {
      setError(e.message || "Failed to load transactions");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  /* ---------- Company balance summary ---------- */
  const cashFlow = useMemo(() => {
    const cashIn  = rows.filter((r) => r.direction === "in").reduce((s, r) => s + num(r.amount), 0);
    const cashOut = rows.filter((r) => r.direction === "out").reduce((s, r) => s + num(r.amount), 0);
    return { cashIn, cashOut };
  }, [rows]);

  const supplierTotals = useMemo(() => totalParties(balances.suppliers), [balances.suppliers]);
  const customerTotals = useMemo(() => totalParties(balances.customers), [balances.customers]);

  /* ---------- Ledger filtering ---------- */
  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (directionFilter && r.direction !== directionFilter) return false;
      if (methodFilter && r.method !== methodFilter) return false;
      if (typeFilter && r.type !== typeFilter) return false;
      return true;
    });
  }, [rows, directionFilter, methodFilter, typeFilter]);

  /* ---------- Detail modal ---------- */
  function referenceLabel(p) {
    if (p.ref_type === "sale") return `Sale #${p.ref_id}`;
    if (p.ref_type === "purchase") return `Purchase #${p.ref_id}`;
    return "Manual / General";
  }

  /* ---------- Print ---------- */
  function printTransactionVoucher(p) {
    const meta = metaForPayment(p);
    const company = p.company || "ScrapLink Pvt.Ltd";
    printVoucher(`
      <div class="voucher-sheet">
        <div class="voucher-head">
          <div class="voucher-brand">${esc(company)}</div>
          <div class="voucher-title">Payment Voucher</div>
        </div>
        <div class="voucher-meta">
          <div>Voucher No.<strong>${esc(p.id)}</strong></div>
          <div>Date<strong>${esc(formatBs(p))} (${esc(p.date_ad ? String(p.date_ad).slice(0, 10) : "-")})</strong></div>
          <div>Company<strong>${esc(company)}</strong></div>
        </div>
        <table class="voucher-table">
          <tr><th>Transaction Type</th><td>${esc(meta.label)}</td></tr>
          <tr><th>Party</th><td>${esc(p.party_label || p.party_key || "-")}</td></tr>
          <tr><th>Direction</th><td>${esc(p.direction === "in" ? "Received (Money In)" : "Paid (Money Out)")}</td></tr>
          <tr><th>Method</th><td>${esc(p.method || "-")}</td></tr>
          <tr><th>Reference</th><td>${esc(referenceLabel(p))}</td></tr>
          <tr><th>Note</th><td>${esc(p.note || "-")}</td></tr>
          <tr class="voucher-amount-row"><th>Amount</th><td>${esc(rupees(p.amount))}</td></tr>
        </table>
        <div class="voucher-signatures">
          <div>Received/Paid By</div>
          <div>Authorized By</div>
        </div>
        <div class="voucher-foot">Printed from ${esc(company)} management system.</div>
      </div>
    `);
  }

  /* ---------- Create + Delete ---------- */
  function openCreate() {
    setForm({
      type: "sale_payment",
      party_type: "customer",
      party_key: "",
      party_label: "",
      direction: "in",
      amount: "",
      method: "Cash",
      ref_type: "manual",
      ref_id: null,
      date_bs_year:  bsToday().year,
      date_bs_month: bsToday().month,
      date_bs_day:   bsToday().day,
      date_ad:       new Date().toISOString().slice(0, 10),
      company: "ScrapLink Pvt.Ltd",
      note: "",
    });
    setFormError(null);
    setShowForm(true);
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true); setFormError(null);
    try {
      if (num(form.amount) <= 0) { setFormError("Amount must be greater than zero."); return; }
      await api.post("/api/transactions", {
        ...form,
        amount: num(form.amount),
        date_bs_year: Number(form.date_bs_year),
        date_bs_month: Number(form.date_bs_month),
        date_bs_day: Number(form.date_bs_day),
      });
      setShowForm(false);
      await load();
    } catch (e) {
      setFormError(e.message || "Could not save transaction");
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await api.del(`/api/transactions/${toDelete.id}`);
      setToDelete(null);
      await load();
    } catch (e) {
      alert(e.message || "Could not delete transaction");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Transactions"
        description="The company cash balance, every payment in or out, and where each supplier and customer stands"
        actions={canCreate ? <Button variant="primary" onClick={openCreate}>+ Record Transaction</Button> : null}
      />

      {/* ---------- Company Balance card ---------- */}
      <div className="bg-surface border border-line rounded-md shadow-card flex flex-wrap items-center justify-between gap-5 px-[26px] py-[22px] mb-6 border-l-[3px] border-l-positive max-[640px]:flex-col max-[640px]:items-start">
        <div>
          <div className="text-xs text-ink-faint uppercase tracking-[0.5px] mb-1.5">Company Balance</div>
          <div className={`text-[30px] font-bold leading-tight tabular-nums max-[640px]:text-[26px] ${(cashFlow.cashIn - cashFlow.cashOut) < 0 ? "text-negative" : ""}`}>
            {rupees(cashFlow.cashIn - cashFlow.cashOut)}
          </div>
          <div className="mt-2 text-xs text-ink-faint max-w-[52ch]">
            Money in minus money out across the entire ledger. Moves only when a transaction is recorded here, not when a purchase or sale is entered.
          </div>
        </div>
        <div className="flex gap-7 max-[640px]:gap-5">
          <FlowStat label="Money In"           value={`+ ${rupees(cashFlow.cashIn)}`}  cls="text-positive" />
          <FlowStat label="Money Out"          value={`− ${rupees(cashFlow.cashOut)}`} cls="text-negative" />
          <FlowStat label="Money to Collect"   value={rupees(customerTotals.due)}      cls="text-positive" />
          <FlowStat label="Money to Pay"       value={rupees(supplierTotals.due)}      cls="text-negative" />
        </div>
      </div>

      {/* ---------- Suppliers grid ---------- */}
      <PartySection
        kind="supplier"
        parties={balances.suppliers}
        totals={supplierTotals}
        onSelect={(row) => setBreakdown({ kind: "supplier", row })}
      />

      {/* ---------- Customers grid ---------- */}
      <PartySection
        kind="customer"
        parties={balances.customers}
        totals={customerTotals}
        onSelect={(row) => setBreakdown({ kind: "customer", row })}
      />

      {/* ---------- Ledger table ---------- */}
      <div className="mt-8 mb-6">
        <div className="flex items-baseline justify-between gap-3 mb-3.5">
          <h2 className="text-[15.5px] font-semibold tracking-tight m-0">Recent Transactions</h2>
          <span className="text-ink-faint text-[12.5px]">
            {filtered.length} entr{filtered.length === 1 ? "y" : "ies"} in this period · In {rupees(cashFlow.cashIn)} · Out {rupees(cashFlow.cashOut)}
          </span>
        </div>

        <p className="text-[11.5px] text-ink-faint bg-surface-sunken rounded-sm px-3 py-2 mb-4">
          Office Expenses and Demolition Expenses are outer costs and never show up here - only real cash moving through the company account does. Click any row to see it in full detail and print it.
        </p>

        <div className="flex items-center gap-2 flex-wrap bg-surface border border-line rounded-md p-2.5 mb-4">
          <label className="text-xs text-ink-faint pl-1">Direction</label>
          <select value={directionFilter} onChange={(e) => setDirectionFilter(e.target.value)} className={selectCls + " !w-auto"}>
            <option value="">All</option>
            <option value="in">Money In</option>
            <option value="out">Money Out</option>
          </select>
          <label className="text-xs text-ink-faint pl-1">Method</label>
          <select value={methodFilter} onChange={(e) => setMethodFilter(e.target.value)} className={selectCls + " !w-auto"}>
            <option value="">All</option>
            <option value="Cash">Cash</option>
            <option value="Online">Online</option>
          </select>
          <label className="text-xs text-ink-faint pl-1">Type</label>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className={selectCls + " !w-auto"}>
            <option value="">All</option>
            {TRANSACTION_TYPES.map((t) => (
              <option key={t.id} value={t.id}>{t.label.split(" — ")[0]}</option>
            ))}
          </select>
        </div>

        {error && (
          <div className="mb-4 text-sm text-negative bg-negative-tint border border-negative-tint rounded-md px-3 py-2">
            {error}
          </div>
        )}

        {loading ? (
          <div className="text-ink-faint text-sm py-8 text-center">Loading transactions…</div>
        ) : (
          <DataTable
            columns={[
              { key: "date_bs", label: "Date (BS)", render: (r) =>
                `${r.date_bs_year}/${String(r.date_bs_month).padStart(2, "0")}/${String(r.date_bs_day).padStart(2, "0")}` },
              { key: "party", label: "Party", render: (r) => r.party_label || r.party_key || "—" },
              { key: "type", label: "Type", render: (r) => metaForPayment(r).label.split(" — ")[0] },
              { key: "direction", label: "Direction",
                render: (r) => (
                  <Badge variant={r.direction === "in" ? "positive" : "warning"}>
                    {r.direction === "in" ? "Received" : "Paid"}
                  </Badge>
                ) },
              { key: "amount", label: "Amount", numeric: true,
                render: (r) => (
                  <span className={r.direction === "in" ? "text-positive" : "text-negative"}>
                    {r.direction === "in" ? "+" : "−"} {rupees(r.amount)}
                  </span>
                ) },
              { key: "method", label: "Method", render: (r) => r.method || "—" },
              { key: "company", label: "Company", render: (r) => r.company || "—" },
              { key: "note", label: "Note", render: (r) => r.note || "—" },
              { key: "actions", label: "", render: (r) => (
                <div className="flex justify-end">
                  {canDel && (
                    <button type="button"
                      onClick={(e) => { e.stopPropagation(); setToDelete(r); }}
                      className="text-negative text-xs hover:underline">Delete</button>
                  )}
                </div>
              ) },
            ]}
            rows={filtered}
            onRowClick={(row) => setDetail(row)}
            emptyMessage="No transactions match the current filter."
          />
        )}
      </div>

      {/* ---------- Transaction detail modal ---------- */}
      {detail && (
        <Modal
          title={`Transaction Detail — ${detail.id}`}
          onClose={() => setDetail(null)}
          wide
          footer={
            <>
              <Button onClick={() => printTransactionVoucher(detail)}>Print</Button>
              <Button onClick={() => setDetail(null)}>Close</Button>
            </>
          }
        >
          <div className="grid grid-cols-2 gap-x-5 gap-y-2.5 max-[560px]:grid-cols-1">
            <DetailPair label="Transaction Type" value={metaForPayment(detail).label} />
            <DetailPair label="Party" value={detail.party_label || detail.party_key || "—"} />
            <DetailPair label="Direction"
              value={
                <span className={`inline-flex items-center px-[9px] py-[3px] rounded-full text-[11.5px] font-semibold ${
                  detail.direction === "in" ? "bg-positive-tint text-positive" : "bg-warning-tint text-warning"
                }`}>
                  {detail.direction === "in" ? "Received (Money In)" : "Paid (Money Out)"}
                </span>
              } />
            <DetailPair label="Amount" value={rupees(detail.amount)} />
            <DetailPair label="Date (BS)" value={formatBs(detail)} />
            <DetailPair label="Date (EN)" value={detail.date_ad ? String(detail.date_ad).slice(0, 10) : "—"} />
            <DetailPair label="Method" value={detail.method || "—"} />
            <DetailPair label="Company" value={detail.company || "—"} />
            <DetailPair label="Reference" value={referenceLabel(detail)} />
            <DetailPair label="Note" value={detail.note || "—"} />
          </div>
        </Modal>
      )}

      {/* ---------- Party breakdown modal ---------- */}
      {breakdown && (
        <PartyBreakdownModal
          kind={breakdown.kind}
          row={breakdown.row}
          onClose={() => setBreakdown(null)}
        />
      )}

      {/* ---------- Create transaction modal ---------- */}
      {showForm && form && (
        <Modal
          title="Record Transaction"
          onClose={() => setShowForm(false)}
          wide
          footer={
            <>
              <Button onClick={() => setShowForm(false)} disabled={saving}>Cancel</Button>
              <Button variant="primary" type="submit" form="tx-form" disabled={saving}>
                {saving ? "Saving…" : "Save Transaction"}
              </Button>
            </>
          }
        >
          <form id="tx-form" onSubmit={save}>
            {formError && (
              <div className="mb-4 text-sm text-negative bg-negative-tint border border-negative-tint rounded-md px-3 py-2">
                {formError}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3.5 mb-5 max-[560px]:grid-cols-1">
              <Field label="Transaction Type" span={2}>
                <select className={selectCls} value={form.type}
                  onChange={(e) => {
                    const meta = TRANSACTION_TYPES.find((t) => t.id === e.target.value);
                    setForm((f) => ({
                      ...f,
                      type: e.target.value,
                      party_type: meta.partyType,
                      direction: meta.direction,
                      ref_type: meta.refType,
                      party_key: "",
                      party_label: "",
                    }));
                  }}>
                  {TRANSACTION_TYPES.map((t) => (
                    <option key={t.id} value={t.id}>{t.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Party" span={2}>
                <input className={inputCls} value={form.party_key}
                  onChange={(e) => setForm((f) => ({ ...f, party_key: e.target.value, party_label: e.target.value }))}
                  placeholder="Party name" />
              </Field>
              <Field label="Amount (Rs)">
                <input type="number" min="0" step="0.01" className={inputCls} value={form.amount} required
                  onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
              </Field>
              <Field label="Method">
                <select className={selectCls} value={form.method}
                  onChange={(e) => setForm((f) => ({ ...f, method: e.target.value }))}>
                  <option value="Cash">Cash</option>
                  <option value="Online">Online</option>
                </select>
              </Field>
              <Field label="Date (BS Year)">
                <input type="number" min="2000" max="2200" className={inputCls} value={form.date_bs_year}
                  onChange={(e) => setForm((f) => ({ ...f, date_bs_year: e.target.value }))} />
              </Field>
              <Field label="Date (BS Month 1-12)">
                <input type="number" min="1" max="12" className={inputCls} value={form.date_bs_month}
                  onChange={(e) => setForm((f) => ({ ...f, date_bs_month: e.target.value }))} />
              </Field>
              <Field label="Date (BS Day)">
                <input type="number" min="1" max="32" className={inputCls} value={form.date_bs_day}
                  onChange={(e) => setForm((f) => ({ ...f, date_bs_day: e.target.value }))} />
              </Field>
              <Field label="Date (AD)">
                <input type="date" className={inputCls} value={form.date_ad}
                  onChange={(e) => setForm((f) => ({ ...f, date_ad: e.target.value }))} />
              </Field>
              <Field label="Company" span={2}>
                <input className={inputCls} value={form.company}
                  onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))} />
              </Field>
              <Field label="Note (optional)" span={2}>
                <input className={inputCls} value={form.note}
                  onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
              </Field>
            </div>
          </form>
        </Modal>
      )}

      {toDelete && (
        <ConfirmDialog
          title="Delete transaction?"
          message="Delete this transaction? The company balance and party balances will update. This can't be undone."
          onCancel={() => setToDelete(null)}
          onConfirm={confirmDelete}
          busy={deleting}
        />
      )}
    </>
  );
}

/* ========================================================================
   Party section — suppliers or customers with cards + summary row
   ======================================================================== */
function PartySection({ kind, parties, totals, onSelect }) {
  const isSupplier = kind === "supplier";
  const title = isSupplier ? "Suppliers — who we buy from" : "Customers — who we sell to";
  const hint = isSupplier
    ? 'Totals are lifetime — click any box to see the full breakdown'
    : 'Totals are lifetime — click any box to see the full breakdown or log a payment';

  return (
    <div className="mb-8">
      <div className="flex items-baseline justify-between gap-3 mb-3.5">
        <h2 className="text-[15.5px] font-semibold tracking-tight m-0">{title}</h2>
        <span className="text-ink-faint text-[12.5px]">{hint}</span>
      </div>

      {/* Summary row */}
      <div className="grid grid-cols-4 gap-px bg-line border border-line rounded-md overflow-hidden mb-4">
        <SummaryCell label={isSupplier ? "Suppliers" : "Customers"} value={String(totals.count)} />
        <SummaryCell label="Total Bill" value={rupees(totals.bill)} />
        <SummaryCell label={isSupplier ? "Total Advance Given" : "Total Advance Received"} value={rupees(totals.advance)} valueClass="text-positive" />
        <SummaryCell label={isSupplier ? "Total Due to Pay" : "Total Due to Collect"} value={rupees(totals.due)} valueClass="text-negative" />
      </div>

      {/* Party cards */}
      {parties.length === 0 ? (
        <div className="text-ink-faint text-sm py-4">
          No {isSupplier ? "suppliers" : "customers"} on file yet.
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-3.5 max-[980px]:grid-cols-2 max-[520px]:grid-cols-1">
          {parties.map((p) => (
            <div
              key={p.id || p.key}
              onClick={() => onSelect(p)}
              className="bg-surface border border-line rounded-md shadow-card px-[18px] py-4 cursor-pointer transition-colors hover:border-steel"
            >
              <div className="flex items-start justify-between gap-2.5 mb-3">
                <h4 className="text-[14px] font-semibold m-0 leading-tight">{p.name}</h4>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  {p.open_orders > 0 && (
                    <span className="badge badge-warning">
                      {p.open_orders} order{p.open_orders === 1 ? "" : "s"} due
                    </span>
                  )}
                  <span className="badge badge-neutral">{p.type === "small" ? "Small" : "Main"}</span>
                </div>
              </div>

              <dl className="flex flex-col gap-2 m-0">
                <PartyLine label="Total Bill" value={rupees(p.billed)} />
                <PartyLine
                  label={isSupplier ? "Advance (given)" : "Advance (received)"}
                  value={rupees(p.paid)}
                  valueClass="text-positive"
                />
                <PartyLine
                  label={p.due < 0 ? (isSupplier ? "Paid ahead" : "Overpaid") : "Due"}
                  value={rupees(Math.abs(p.due))}
                  valueClass={p.due < 0 ? "text-positive" : "text-negative"}
                />
              </dl>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SummaryCell({ label, value, valueClass = "" }) {
  return (
    <div className="bg-surface px-4 py-3.5">
      <div className="text-[11.5px] text-ink-faint mb-1.5">{label}</div>
      <div className={`text-[16px] font-semibold tabular-nums ${valueClass}`}>{value}</div>
    </div>
  );
}

function FlowStat({ label, value, cls }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11.5px] text-ink-faint">{label}</span>
      <span className={`text-[17px] font-semibold tabular-nums ${cls}`}>{value}</span>
    </div>
  );
}

function PartyLine({ label, value, valueClass = "" }) {
  return (
    <div className="flex items-baseline justify-between gap-2.5 text-[12.5px]">
      <dt className="text-ink-faint">{label}</dt>
      <dd className={`m-0 font-semibold tabular-nums ${valueClass}`}>{value}</dd>
    </div>
  );
}

function totalParties(parties) {
  return parties.reduce((acc, p) => ({
    count: acc.count + 1,
    bill: acc.bill + num(p.billed),
    advance: acc.advance + num(p.paid),
    due: acc.due + Math.max(0, num(p.due)),
  }), { count: 0, bill: 0, advance: 0, due: 0 });
}

/* ========================================================================
   Party breakdown modal — bills + payments for one supplier/customer
   ======================================================================== */
function PartyBreakdownModal({ kind, row, onClose }) {
  const isSupplier = kind === "supplier";
  const bills = row.bills || [];
  const payments = row.payments || [];

  return (
    <Modal
      title={`${row.name} — full breakdown`}
      onClose={onClose}
      wide
      footer={<Button onClick={onClose}>Close</Button>}
    >
      <div className="grid grid-cols-4 gap-3 mb-5 max-[980px]:grid-cols-2 max-[520px]:grid-cols-1">
        <StatBox label="Type" value={row.type === "small" ? "Small" : "Main"} />
        <StatBox label="Total Bill" value={rupees(row.billed)} />
        <StatBox label={isSupplier ? "Advance Given" : "Advance Received"} value={rupees(row.paid)} valueClass="text-positive" />
        <StatBox
          label={row.due < 0 ? (isSupplier ? "Paid Ahead" : "Overpaid") : "Due"}
          value={rupees(Math.abs(row.due))}
          valueClass={row.due < 0 ? "text-positive" : "text-negative"}
        />
      </div>

      <h4 className="text-[13.5px] font-semibold mb-2">
        {isSupplier ? "Purchases billed to us" : "Sales billed to them"} — makes up the Total Bill
      </h4>
      <div className="overflow-x-auto border border-line rounded-md bg-surface mb-5">
        <table className="w-full border-collapse min-w-[520px]">
          <thead>
            <tr>
              <th className="text-[11.5px] uppercase tracking-[0.04em] text-ink-faint font-semibold text-left px-3 py-[10px] border-b border-line">Date (BS)</th>
              <th className="text-[11.5px] uppercase tracking-[0.04em] text-ink-faint font-semibold text-left px-3 py-[10px] border-b border-line">Invoice</th>
              <th className="text-[11.5px] uppercase tracking-[0.04em] text-ink-faint font-semibold text-left px-3 py-[10px] border-b border-line">{isSupplier ? "Material" : "Product"}</th>
              <th className="text-[11.5px] uppercase tracking-[0.04em] text-ink-faint font-semibold text-right px-3 py-[10px] border-b border-line">Amount</th>
            </tr>
          </thead>
          <tbody>
            {bills.length === 0 ? (
              <tr><td colSpan={4} className="text-center text-ink-faint py-6 text-[13px]">No bills on record yet.</td></tr>
            ) : bills.map((b, i) => (
              <tr key={i}>
                <td className="px-3 py-2 border-b border-line-soft text-[13px]">{b.date_bs || "—"}</td>
                <td className="px-3 py-2 border-b border-line-soft text-[13px]">{b.invoice || "—"}</td>
                <td className="px-3 py-2 border-b border-line-soft text-[13px]">{b.item || "—"}</td>
                <td className="px-3 py-2 border-b border-line-soft text-[13px] text-right tabular-nums">{rupees(b.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h4 className="text-[13.5px] font-semibold mb-2">Transactions — makes up the Advance</h4>
      <div className="overflow-x-auto border border-line rounded-md bg-surface">
        <table className="w-full border-collapse min-w-[520px]">
          <thead>
            <tr>
              <th className="text-[11.5px] uppercase tracking-[0.04em] text-ink-faint font-semibold text-left px-3 py-[10px] border-b border-line">Date (BS)</th>
              <th className="text-[11.5px] uppercase tracking-[0.04em] text-ink-faint font-semibold text-left px-3 py-[10px] border-b border-line">Method</th>
              <th className="text-[11.5px] uppercase tracking-[0.04em] text-ink-faint font-semibold text-left px-3 py-[10px] border-b border-line">Note</th>
              <th className="text-[11.5px] uppercase tracking-[0.04em] text-ink-faint font-semibold text-right px-3 py-[10px] border-b border-line">Amount</th>
            </tr>
          </thead>
          <tbody>
            {payments.length === 0 ? (
              <tr><td colSpan={4} className="text-center text-ink-faint py-6 text-[13px]">No payments on record yet.</td></tr>
            ) : payments.map((p, i) => (
              <tr key={i}>
                <td className="px-3 py-2 border-b border-line-soft text-[13px]">{p.date_bs || "—"}</td>
                <td className="px-3 py-2 border-b border-line-soft text-[13px]">{p.method || "—"}</td>
                <td className="px-3 py-2 border-b border-line-soft text-[13px]">{p.note || "—"}</td>
                <td className="px-3 py-2 border-b border-line-soft text-[13px] text-right tabular-nums">{rupees(p.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

function StatBox({ label, value, valueClass = "" }) {
  return (
    <div className="bg-surface-sunken border border-line-soft rounded-sm px-3.5 py-[13px]">
      <div className="text-[11.5px] text-ink-faint mb-1.5">{label}</div>
      <div className={`text-base font-semibold tabular-nums ${valueClass}`}>{value}</div>
    </div>
  );
}

function DetailPair({ label, value }) {
  return (
    <div>
      <div className="text-[11.5px] text-ink-faint mb-0.5">{label}</div>
      <div className="text-[13.5px] font-medium">{value}</div>
    </div>
  );
}
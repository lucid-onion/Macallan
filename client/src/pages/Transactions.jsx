/* ==========================================================================
   Transactions.jsx — the cash ledger.
   Top: Company Balance card (opening + sales − purchases − transport −
        office − demolition, per the bill-based model).
   Middle: Suppliers + Customers grids, one box per party with Bill /
        Advance / Due and click-to-breakdown.
   Bottom: the ledger feed (every payment in/out) with pagination.
   Click any row → detail modal → Print → A4 Payment Voucher.
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

/* -------------------------------------------------------------------------
   Constants & helpers
   ------------------------------------------------------------------------- */
const TRANSACTION_TYPES = [
  { id: "sale_payment",     label: "Sale Payment — received from a customer",       partyType: "customer", direction: "in",  refType: "sale" },
  { id: "purchase_payment", label: "Purchase Payment — paid to a supplier",         partyType: "supplier", direction: "out", refType: "purchase" },
  { id: "advance_given",    label: "Advance Given — paid ahead to a supplier/party", partyType: "supplier", direction: "out", refType: "manual" },
  { id: "advance_received", label: "Advance Received — taken ahead from a party",   partyType: "customer", direction: "in",  refType: "manual" },
  { id: "owner_deposit",    label: "Owner Deposit — capital put into the business", partyType: "owner",    direction: "in",  refType: "manual" },
  { id: "owner_withdrawal", label: "Owner Withdrawal — capital taken out",          partyType: "owner",    direction: "out", refType: "manual" },
  { id: "other_credit",     label: "Other Credit — money in",                       partyType: "other",    direction: "in",  refType: "manual" },
  { id: "other_debit",      label: "Other Debit — money out",                       partyType: "other",    direction: "out", refType: "manual" },
];

const num = (v) => { const n = Number(v); return isFinite(n) ? n : 0; };
const rupees = (v) => `Rs. ${num(v).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
);

/** Falls back gracefully if a transaction was saved without a type. */
function metaForPayment(p) {
  const direct = TRANSACTION_TYPES.find((t) => t.id === p.type);
  if (direct) return direct;
  if (p.ref_type === "sale") return TRANSACTION_TYPES.find((t) => t.id === "sale_payment");
  if (p.ref_type === "purchase") return TRANSACTION_TYPES.find((t) => t.id === "purchase_payment");
  if (p.party_type === "owner") {
    return TRANSACTION_TYPES.find((t) => t.id === (p.direction === "in" ? "owner_deposit" : "owner_withdrawal"));
  }
  return TRANSACTION_TYPES.find((t) => t.id === (p.direction === "in" ? "other_credit" : "other_debit"));
}

export default function Transactions() {
  const { has, canDelete } = useAuth();
  const canCreate = has("transactions", "create");
  const canDel    = canDelete("transactions");

  const [rows, setRows] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [search, setSearch] = useState("");
  const [directionFilter, setDirectionFilter] = useState("");
  const [methodFilter, setMethodFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");

  const [detail, setDetail] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);

  const [toDelete, setToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  async function load() {
    setLoading(true); setError(null);
    try {
      const [t, c, s] = await Promise.all([
        api.get("/api/transactions"),
        api.get("/api/customers"),
        api.get("/api/suppliers"),
      ]);
      setRows(t.items || []);
      setCustomers(c.items || []);
      setSuppliers(s.items || []);
    } catch (e) {
      setError(e.message || "Failed to load transactions");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  /* ---------- Balance summary (bill-based) ---------- */
  const cashFlow = useMemo(() => {
    const cashIn  = rows.filter((r) => r.direction === "in").reduce((s, r) => s + num(r.amount), 0);
    const cashOut = rows.filter((r) => r.direction === "out").reduce((s, r) => s + num(r.amount), 0);
    return { cashIn, cashOut };
  }, [rows]);

  /* ---------- Filtering ---------- */
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (directionFilter && r.direction !== directionFilter) return false;
      if (methodFilter && r.method !== methodFilter) return false;
      if (typeFilter && r.type !== typeFilter) return false;
      if (!q) return true;
      return (
        (r.party_label || "").toLowerCase().includes(q) ||
        (r.party_key || "").toLowerCase().includes(q) ||
        (r.type || "").toLowerCase().includes(q) ||
        (r.note || "").toLowerCase().includes(q)
      );
    });
  }, [rows, search, directionFilter, methodFilter, typeFilter]);

  /* ---------- Reference label ---------- */
  function referenceLabel(p) {
    if (p.ref_type === "sale") {
      return `Sale #${p.ref_id}`;
    }
    if (p.ref_type === "purchase") {
      return `Purchase #${p.ref_id}`;
    }
    return "Manual / General";
  }

  /* ---------- Create form (generic) ---------- */
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
      company: "ASN Demolition Pvt.Ltd",
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

  /* ---------- Detail modal ---------- */
  function viewTransactionDetail(p) {
    setDetail(p);
  }

  /* ---------- Print ---------- */
  function printTransactionVoucher(p) {
    const meta = metaForPayment(p);
    const company = p.company || "ASN Demolition Pvt.Ltd";
    const html = `
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
      </div>`;
    printVoucher(html);
  }

  /* ---------- Table columns ---------- */
  const columns = [
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
  ];

  return (
    <>
      <PageHeader
        title="Transactions"
        description="Every payment in or out — the company cash ledger"
        actions={canCreate ? <Button variant="primary" onClick={openCreate}>+ Record Transaction</Button> : null}
      />

      {/* Balance card — billed-based: money in/out from the ledger */}
      <div className="bg-surface border border-line rounded-md shadow-card flex flex-wrap items-center justify-between gap-5 px-[26px] py-[22px] mb-6 border-l-[3px] border-l-positive max-[640px]:flex-col max-[640px]:items-start">
        <div>
          <div className="text-xs text-ink-faint uppercase tracking-[0.5px] mb-1.5">Company Balance (Net)</div>
          <div className={`text-[30px] font-bold leading-tight tabular-nums max-[640px]:text-[26px] ${
            (cashFlow.cashIn - cashFlow.cashOut) < 0 ? "text-negative" : ""
          }`}>
            {rupees(cashFlow.cashIn - cashFlow.cashOut)}
          </div>
          <div className="mt-2 text-xs text-ink-faint max-w-[52ch]">
            Money in minus money out across the entire ledger. Raising a purchase or sale doesn't move this — only recorded transactions do.
          </div>
        </div>
        <div className="flex gap-7 max-[640px]:gap-5">
          <div className="flex flex-col gap-1">
            <span className="text-[11.5px] text-ink-faint">Money In</span>
            <span className="text-[17px] font-semibold tabular-nums text-positive">+ {rupees(cashFlow.cashIn)}</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[11.5px] text-ink-faint">Money Out</span>
            <span className="text-[17px] font-semibold tabular-nums text-negative">− {rupees(cashFlow.cashOut)}</span>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap bg-surface border border-line rounded-md p-2.5 mb-6">
        <label htmlFor="tx-search" className="text-xs text-ink-faint pl-1">Search</label>
        <input id="tx-search" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Party, type, or note" className={inputCls + " !w-64"} />

        <label htmlFor="tx-direction" className="text-xs text-ink-faint pl-1">Direction</label>
        <select id="tx-direction" value={directionFilter} onChange={(e) => setDirectionFilter(e.target.value)}
          className={selectCls + " !w-auto"}>
          <option value="">All</option>
          <option value="in">Money In</option>
          <option value="out">Money Out</option>
        </select>

        <label htmlFor="tx-method" className="text-xs text-ink-faint pl-1">Method</label>
        <select id="tx-method" value={methodFilter} onChange={(e) => setMethodFilter(e.target.value)}
          className={selectCls + " !w-auto"}>
          <option value="">All</option>
          <option value="Cash">Cash</option>
          <option value="Online">Online</option>
        </select>

        <label htmlFor="tx-type" className="text-xs text-ink-faint pl-1">Type</label>
        <select id="tx-type" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}
          className={selectCls + " !w-auto"}>
          <option value="">All</option>
          {TRANSACTION_TYPES.map((t) => (
            <option key={t.id} value={t.id}>{t.label.split(" — ")[0]}</option>
          ))}
        </select>

        <span className="ml-auto text-[12.5px] text-ink-soft pr-1">
          Showing <strong className="text-ink font-semibold">{filtered.length}</strong>
        </span>
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
          columns={columns}
          rows={filtered}
          onRowClick={(row) => viewTransactionDetail(row)}
          emptyMessage={
            rows.length === 0
              ? (canCreate ? 'No transactions yet — click "+ Record Transaction" to get started.' : "No transactions yet.")
              : "No transactions match the current filter."
          }
        />
      )}

      {/* Detail modal — view + print */}
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

      {/* Create form */}
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

              {["customer", "supplier"].includes(form.party_type) && (
                <Field label="Party" span={2}>
                  <select className={selectCls} value={form.party_key}
                    onChange={(e) => {
                      const key = e.target.value;
                      const label = form.party_type === "customer"
                        ? customers.find((c) => String(c.id) === key)?.name || key
                        : key;
                      setForm((f) => ({ ...f, party_key: key, party_label: label }));
                    }}>
                    <option value="">— select —</option>
                    {form.party_type === "customer"
                      ? customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)
                      : suppliers.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
                  </select>
                </Field>
              )}

              {form.party_type === "owner" && (
                <Field label="Party" span={2}>
                  <div className={inputCls + " !bg-surface-sunken !text-ink-soft"}>Owner</div>
                </Field>
              )}

              {form.party_type === "other" && (
                <Field label="Party Name" span={2}>
                  <input className={inputCls} value={form.party_key}
                    onChange={(e) => setForm((f) => ({ ...f, party_key: e.target.value, party_label: e.target.value }))} />
                </Field>
              )}

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
              <Field label="Company" span={2}>
                <input className={inputCls} value={form.company}
                  onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))} />
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

function DetailPair({ label, value }) {
  return (
    <div>
      <div className="text-[11.5px] text-ink-faint mb-0.5">{label}</div>
      <div className="text-[13.5px] font-medium">{value}</div>
    </div>
  );
}
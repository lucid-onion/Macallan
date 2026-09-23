/* ==========================================================================
   Transactions.jsx — company cash ledger.
   Top: a balance card showing opening balance + net cash movement.
   Bottom: the ledger — one row per payment, filterable, paginated.
   ========================================================================== */
import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import {
  Button, Modal, Field, ConfirmDialog, Badge, PageHeader,
  inputCls, selectCls,
} from "../components/ui";
import DataTable from "../components/DataTable";

const today = new Date();

const EMPTY_FORM = {
  type: "sale_payment",
  party_type: "customer",
  party_key: "",
  party_label: "",
  direction: "in",
  amount: "",
  method: "Cash",
  ref_type: "manual",
  ref_id: null,
  date_bs_year: 2082,
  date_bs_month: 1,
  date_bs_day: 1,
  date_ad: today.toISOString().slice(0, 10),
  company: "ASN Demolition Pvt.Ltd",
  note: "",
};

const TRANSACTION_TYPES = [
  { id: "sale_payment",      label: "Sale Payment — received from a customer",       partyType: "customer", direction: "in"  },
  { id: "purchase_payment",  label: "Purchase Payment — paid to a supplier",          partyType: "supplier", direction: "out" },
  { id: "advance_given",     label: "Advance Given — paid ahead to a supplier/party", partyType: "supplier", direction: "out" },
  { id: "advance_received",  label: "Advance Received — taken ahead from a party",    partyType: "customer", direction: "in"  },
  { id: "owner_deposit",     label: "Owner Deposit — capital put into the business",  partyType: "owner",    direction: "in"  },
  { id: "owner_withdrawal",  label: "Owner Withdrawal — capital taken out",           partyType: "owner",    direction: "out" },
  { id: "other_credit",      label: "Other Credit — money in",                        partyType: "other",    direction: "in"  },
  { id: "other_debit",       label: "Other Debit — money out",                        partyType: "other",    direction: "out" },
];

function num(v) { const n = Number(v); return isFinite(n) ? n : 0; }

export default function Transactions() {
  const { has } = useAuth();
  const canCreate = has("transactions", "create");
  const canDelete = has("transactions", "delete");

  const [rows, setRows] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [search, setSearch] = useState("");
  const [directionFilter, setDirectionFilter] = useState("");
  const [methodFilter, setMethodFilter] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
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
      setRows(t.items);
      setCustomers(c.items);
      setSuppliers(s.items);
    } catch (e) {
      setError(e.message || "Failed to load transactions");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  // ---- Balance ----------------------------------------------------------
  const balance = useMemo(() => {
    const cashIn  = rows.filter(r => r.direction === "in").reduce((s, r) => s + num(r.amount), 0);
    const cashOut = rows.filter(r => r.direction === "out").reduce((s, r) => s + num(r.amount), 0);
    return { cashIn, cashOut, net: cashIn - cashOut };
  }, [rows]);

  // ---- Filtering --------------------------------------------------------
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (directionFilter && r.direction !== directionFilter) return false;
      if (methodFilter && r.method !== methodFilter) return false;
      if (!q) return true;
      return (
        r.party_label?.toLowerCase().includes(q) ||
        r.type?.toLowerCase().includes(q) ||
        r.note?.toLowerCase().includes(q)
      );
    });
  }, [rows, search, directionFilter, methodFilter]);

  // ---- Form -------------------------------------------------------------
  const currentType = useMemo(
    () => TRANSACTION_TYPES.find(t => t.id === form.type) || TRANSACTION_TYPES[0],
    [form.type]
  );

  const partyOptions = useMemo(() => {
    if (currentType.partyType === "customer") return customers.map(c => ({ key: c.id, label: c.name }));
    if (currentType.partyType === "supplier") return suppliers.map(s => ({ key: s.name, label: s.name }));
    return [];
  }, [currentType.partyType, customers, suppliers]);

  function openCreate() {
    setForm({ ...EMPTY_FORM });
    setFormError(null);
    setShowForm(true);
  }

  function onTypeChange(newType) {
    const meta = TRANSACTION_TYPES.find(t => t.id === newType);
    setForm(f => ({
      ...f,
      type: newType,
      party_type: meta.partyType,
      direction: meta.direction,
      party_key: "",
      party_label: "",
    }));
  }

  async function save(e) {
    e.preventDefault(); setSaving(true); setFormError(null);
    try {
      let partyKey = form.party_key, partyLabel = form.party_label;
      if (currentType.partyType === "owner") { partyKey = "owner"; partyLabel = "Owner"; }

      if (currentType.partyType !== "owner" && !partyKey) {
        setFormError("Select or enter a party.");
        return;
      }
      if (num(form.amount) <= 0) {
        setFormError("Amount must be greater than zero.");
        return;
      }

      const payload = {
        type: form.type,
        party_type: currentType.partyType,
        party_key: partyKey,
        party_label: partyLabel || partyKey,
        direction: currentType.direction,
        amount: num(form.amount),
        method: form.method,
        ref_type: "manual",
        ref_id: null,
        date_bs_year: Number(form.date_bs_year),
        date_bs_month: Number(form.date_bs_month),
        date_bs_day: Number(form.date_bs_day),
        date_ad: form.date_ad,
        company: form.company.trim() || undefined,
        note: form.note.trim() || undefined,
      };

      await api.post("/api/transactions", payload);
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

  const columns = [
    { key: "date_bs", label: "Date (BS)",
      render: (r) => `${r.date_bs_year}/${String(r.date_bs_month).padStart(2, "0")}/${String(r.date_bs_day).padStart(2, "0")}` },
    { key: "party", label: "Party", render: (r) => r.party_label || r.party_key || "—" },
    { key: "type", label: "Type", render: (r) => r.type?.replace(/_/g, " ") || "—" },
    { key: "direction", label: "Direction",
      render: (r) => (
        <Badge variant={r.direction === "in" ? "positive" : "warning"}>
          {r.direction === "in" ? "Received" : "Paid"}
        </Badge>
      ) },
    { key: "amount", label: "Amount", numeric: true,
      render: (r) => (
        <span className={r.direction === "in" ? "text-positive" : "text-negative"}>
          {r.direction === "in" ? "+" : "−"} Rs. {num(r.amount).toLocaleString("en-IN")}
        </span>
      ) },
    { key: "method", label: "Method", render: (r) => r.method || "—" },
    { key: "company", label: "Company", render: (r) => r.company || "—" },
    { key: "note", label: "Note", render: (r) => r.note || "—" },
    { key: "actions", label: "",
      render: (r) => (
        <div className="flex justify-end">
          {canDelete && (
            <button type="button" onClick={(e) => { e.stopPropagation(); setToDelete(r); }}
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

      {/* Balance card */}
      <div className="bg-surface border border-line rounded-md shadow-card flex flex-wrap items-center justify-between gap-5 px-[26px] py-[22px] mb-6 border-l-[3px] border-l-positive max-[640px]:flex-col max-[640px]:items-start">
        <div>
          <div className="text-xs text-ink-faint uppercase tracking-[0.5px] mb-1.5">Company Balance (Net)</div>
          <div className={`text-[30px] font-bold leading-tight tabular-nums max-[640px]:text-[26px] ${balance.net < 0 ? "text-negative" : ""}`}>
            Rs. {balance.net.toLocaleString("en-IN")}
          </div>
          <div className="mt-2 text-xs text-ink-faint max-w-[52ch]">
            Money in minus money out across the entire ledger. Raising a purchase or sale doesn't move this — only recorded transactions do.
          </div>
        </div>
        <div className="flex gap-7 max-[640px]:gap-5">
          <div className="flex flex-col gap-1">
            <span className="text-[11.5px] text-ink-faint">Money In</span>
            <span className="text-[17px] font-semibold tabular-nums text-positive">+ Rs. {balance.cashIn.toLocaleString("en-IN")}</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[11.5px] text-ink-faint">Money Out</span>
            <span className="text-[17px] font-semibold tabular-nums text-negative">− Rs. {balance.cashOut.toLocaleString("en-IN")}</span>
          </div>
        </div>
      </div>

      {/* Filter bar */}
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
          emptyMessage={
            rows.length === 0
              ? (canCreate ? 'No transactions yet — click "+ Record Transaction" to get started.' : "No transactions yet.")
              : "No transactions match the current filter."
          }
        />
      )}

      {showForm && (
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
                  onChange={(e) => onTypeChange(e.target.value)}>
                  {TRANSACTION_TYPES.map(t => (
                    <option key={t.id} value={t.id}>{t.label}</option>
                  ))}
                </select>
              </Field>

              {currentType.partyType !== "owner" && currentType.partyType !== "other" && (
                <Field label="Party" span={2}>
                  <select className={selectCls} value={form.party_key}
                    onChange={(e) => setForm(f => ({ ...f, party_key: e.target.value, party_label: e.target.value }))}>
                    <option value="">— select —</option>
                    {partyOptions.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
                  </select>
                </Field>
              )}
              {currentType.partyType === "other" && (
                <Field label="Party Name" span={2}>
                  <input className={inputCls} value={form.party_key}
                    onChange={(e) => setForm(f => ({ ...f, party_key: e.target.value, party_label: e.target.value }))} />
                </Field>
              )}
              {currentType.partyType === "owner" && (
                <Field label="Party" span={2}>
                  <div className={inputCls + " !bg-surface-sunken !text-ink-soft"}>Owner</div>
                </Field>
              )}

              <Field label="Amount (Rs)">
                <input type="number" min="0" step="0.01" className={inputCls} value={form.amount} required
                  onChange={(e) => setForm(f => ({ ...f, amount: e.target.value }))} />
              </Field>
              <Field label="Method">
                <select className={selectCls} value={form.method}
                  onChange={(e) => setForm(f => ({ ...f, method: e.target.value }))}>
                  <option value="Cash">Cash</option>
                  <option value="Online">Online</option>
                </select>
              </Field>
              <Field label="Company" span={2}>
                <input className={inputCls} value={form.company}
                  onChange={(e) => setForm(f => ({ ...f, company: e.target.value }))} />
              </Field>

              <Field label="Date (BS Year)">
                <input type="number" min="2000" max="2200" className={inputCls} value={form.date_bs_year}
                  onChange={(e) => setForm(f => ({ ...f, date_bs_year: e.target.value }))} />
              </Field>
              <Field label="Date (BS Month 1-12)">
                <input type="number" min="1" max="12" className={inputCls} value={form.date_bs_month}
                  onChange={(e) => setForm(f => ({ ...f, date_bs_month: e.target.value }))} />
              </Field>
              <Field label="Date (BS Day)">
                <input type="number" min="1" max="32" className={inputCls} value={form.date_bs_day}
                  onChange={(e) => setForm(f => ({ ...f, date_bs_day: e.target.value }))} />
              </Field>
              <Field label="Date (AD)">
                <input type="date" className={inputCls} value={form.date_ad}
                  onChange={(e) => setForm(f => ({ ...f, date_ad: e.target.value }))} />
              </Field>

              <Field label="Note (optional)" span={2}>
                <input className={inputCls} value={form.note}
                  onChange={(e) => setForm(f => ({ ...f, note: e.target.value }))} />
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
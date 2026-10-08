/* ==========================================================================
   Suppliers.jsx — supplier groups with period filter, cards grid, and a
   per-supplier detail panel showing purchase activity for the period.
   ========================================================================== */
import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import {
  Button, Modal, Field, ConfirmDialog, Badge, PageHeader,
  inputCls, selectCls,
} from "../components/ui";
import DataTable from "../components/DataTable";
import { NEPALI_MONTHS_EN } from "../lib/nepali-date";

const EMPTY_FORM = { name: "", contact: "", phone: "", type: "main" };

const num = (v) => { const n = Number(v); return isFinite(n) ? n : 0; };
const rupees = (v) => `Rs. ${num(v).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const kg = (v) => `${num(v).toLocaleString("en-US", { maximumFractionDigits: 2 })} kg`;
const pad = (n) => String(n).padStart(2, "0");
const bsStr = (r) => `${r.date_bs_year}/${pad(r.date_bs_month)}/${pad(r.date_bs_day)}`;
const adStr = (r) => (r.date_ad ? String(r.date_ad).slice(0, 10) : "—");

/** Period filter: matches rows whose BS year/month/day falls in the window. */
function inPeriod(row, period) {
  if (period.year  && Number(row.date_bs_year)  !== period.year)  return false;
  if (period.month && Number(row.date_bs_month) !== period.month) return false;
  if (period.day   && Number(row.date_bs_day)   !== period.day)   return false;
  return true;
}

export default function Suppliers() {
  const { has, canDelete } = useAuth();
  const canCreate = has("suppliers", "create");
  const canUpdate = has("suppliers", "update");
  const canDel    = canDelete("suppliers");

  const [suppliers, setSuppliers]   = useState([]);
  const [purchases, setPurchases]   = useState([]);
  const [transport, setTransport]   = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);
  const [selectedId, setSelectedId] = useState(null);

  const [period, setPeriod] = useState({
    year: new Date().getFullYear() + 57,
    month: null,
    week:  null,
    day:   null,
  });

  // ---------- Filters applied to the aggregate numbers ----------
  const filteredPurchases = useMemo(
    () => purchases.filter((p) => inPeriod(p, period)),
    [purchases, period]
  );
  const filteredTransport = useMemo(
    () => transport.filter((t) => inPeriod(t, period)),
    [transport, period]
  );

  // ---------- Load ----------
  async function load() {
    setLoading(true); setError(null);
    try {
      const [s, p, t] = await Promise.all([
        api.get("/api/suppliers"),
        api.get("/api/purchases"),
        api.get("/api/transportation"),
      ]);
      setSuppliers(s.items || []);
      setPurchases(p.items || []);
      setTransport(t.items || []);
      if (!selectedId && s.items?.[0]) setSelectedId(s.items[0].id);
    } catch (e) {
      setError(e.message || "Failed to load suppliers");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  // ---------- Per-supplier rollups ----------
  function summaryForSupplier(supplier) {
    const rows = filteredPurchases.filter((p) => Number(p.supplier_id) === Number(supplier.id));
    const total = rows.reduce((s, r) => s + num(r.total), 0);
    const qty   = rows.reduce((s, r) => s + num(r.net_qty), 0);
    const ids   = new Set(rows.map((r) => r.id));
    const trans = filteredTransport.filter((t) => t.purchase_id && ids.has(Number(t.purchase_id)));
    const transportCost = trans.reduce(
      (s, t) => s + num(t.fee) + num(t.labor_charge) + num(t.road_expense) + num(t.tax_gbse),
      0
    );
    const advance = num(supplier.advance_amount);
    const billed  = num(supplier.total_purchases);
    const due     = Math.max(0, billed - advance);
    return { rows, total, qty, loads: rows.length, transportCost, advance, billed, due };
  }

  const cards = useMemo(() => {
    const summaries = suppliers.map((s) => ({ supplier: s, ...summaryForSupplier(s) }));
    const max = Math.max(1, ...summaries.map((s) => s.total));
    return { summaries, max };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suppliers, filteredPurchases, filteredTransport]);

  const selected = useMemo(
    () => suppliers.find((s) => s.id === selectedId) || null,
    [suppliers, selectedId]
  );
  const detail = useMemo(
    () => (selected ? summaryForSupplier(selected) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selected, filteredPurchases, filteredTransport]
  );

  // ---------- Form ----------
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing]   = useState(null);
  const [form, setForm]         = useState(EMPTY_FORM);
  const [saving, setSaving]     = useState(false);
  const [formError, setFormError] = useState(null);

  function openCreate() {
    setEditing(null); setForm(EMPTY_FORM); setFormError(null); setShowForm(true);
  }
  function openEdit(row) {
    setEditing(row);
    setForm({
      name: row.name || "",
      contact: row.contact || "",
      phone: row.phone || "",
      type: row.type || "main",
    });
    setFormError(null); setShowForm(true);
  }

  async function save(e) {
    e.preventDefault(); setSaving(true); setFormError(null);
    try {
      const payload = {
        name: form.name.trim(),
        contact: form.contact.trim() || undefined,
        phone: form.phone.trim() || undefined,
        type: form.type,
      };
      if (!payload.name) { setFormError("Name is required."); return; }
      if (editing) await api.patch(`/api/suppliers/${editing.id}`, payload);
      else         await api.post("/api/suppliers", payload);
      setShowForm(false);
      await load();
    } catch (e) {
      setFormError(e.message || "Could not save supplier");
    } finally {
      setSaving(false);
    }
  }

  const [toDelete, setToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  async function confirmDelete() {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await api.del(`/api/suppliers/${toDelete.id}`);
      setToDelete(null);
      if (selectedId === toDelete.id) setSelectedId(null);
      await load();
    } catch (e) {
      alert(e.message || "Could not delete supplier");
    } finally {
      setDeleting(false);
    }
  }

  // ---------- Period dropdowns ----------
  const availableYears = useMemo(() => {
    const years = new Set([period.year]);
    purchases.forEach((r) => years.add(Number(r.date_bs_year)));
    return [...years].sort((a, b) => a - b);
  }, [purchases, period.year]);

  // ---------- Render ----------
  return (
    <>
      <PageHeader
        title="Suppliers"
        description="Everyone we buy from, their purchase activity and payment position"
        actions={canCreate ? <Button variant="primary" onClick={openCreate}>+ Add Supplier</Button> : null}
      />

      {/* Filter bar */}
      <div className="flex items-center gap-2 flex-wrap bg-surface border border-line rounded-md p-2.5 mb-6">
        <label className="text-xs text-ink-faint pl-1">Year</label>
        <select
          value={period.year}
          onChange={(e) => setPeriod((p) => ({ ...p, year: Number(e.target.value) }))}
          className={selectCls + " !w-auto"}>
          {availableYears.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>

        <label className="text-xs text-ink-faint pl-1">Month</label>
        <select
          value={period.month || ""}
          onChange={(e) => setPeriod((p) => ({ ...p, month: e.target.value ? Number(e.target.value) : null }))}
          className={selectCls + " !w-auto"}>
          <option value="">All months</option>
          {NEPALI_MONTHS_EN.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
        </select>

        <label className="text-xs text-ink-faint pl-1">Day</label>
        <input type="number" min="1" max="32" placeholder="All"
          value={period.day ?? ""}
          onChange={(e) => setPeriod((p) => ({ ...p, day: e.target.value ? Number(e.target.value) : null }))}
          className={inputCls + " !w-20"} />

        <span className="ml-auto text-[12.5px] text-ink-soft pr-1">
          Showing{" "}
          <strong className="text-ink font-semibold">
            {period.month ? NEPALI_MONTHS_EN[period.month - 1] : "All months"} {period.year}
            {period.day ? ` / ${period.day}` : ""}
          </strong>
        </span>
      </div>

      {error && (
        <div className="mb-4 text-sm text-negative bg-negative-tint border border-negative-tint rounded-md px-3 py-2">
          {error}
        </div>
      )}

      {/* Supplier cards */}
      <div className="mb-6">
        <div className="flex items-baseline justify-between gap-3 mb-3.5">
          <h2 className="text-[15.5px] font-semibold tracking-tight m-0">Suppliers</h2>
          <span className="text-ink-faint text-[12.5px]">Click a supplier to see their full purchase history below</span>
        </div>

        {loading ? (
          <div className="text-ink-faint text-sm py-6">Loading suppliers…</div>
        ) : cards.summaries.length === 0 ? (
          <div className="text-ink-faint text-sm py-6">
            No suppliers yet. {canCreate ? 'Click "+ Add Supplier" to get started.' : ""}
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-3.5 max-[980px]:grid-cols-2 max-[520px]:grid-cols-1">
            {cards.summaries.map((s) => {
              const isSelected = s.supplier.id === selectedId;
              return (
                <div
                  key={s.supplier.id}
                  onClick={() => setSelectedId(s.supplier.id)}
                  className={`bg-surface border rounded-md shadow-card px-[18px] py-4 cursor-pointer transition-colors ${
                    isSelected ? "border-steel" : "border-line hover:border-steel"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <h4 className="text-[14px] font-semibold m-0 leading-tight">{s.supplier.name}</h4>
                    <div className="flex gap-0.5 shrink-0">
                      {canUpdate && (
                        <button type="button"
                          onClick={(e) => { e.stopPropagation(); openEdit(s.supplier); }}
                          className="text-ink-faint hover:text-ink w-5 h-5 rounded-sm hover:bg-surface-sunken flex items-center justify-center text-xs"
                          title="Edit supplier">✎</button>
                      )}
                      {canDel && (
                        <button type="button"
                          onClick={(e) => { e.stopPropagation(); setToDelete(s.supplier); }}
                          className="text-ink-faint hover:text-negative w-5 h-5 rounded-sm hover:bg-negative-tint flex items-center justify-center text-xs"
                          title="Delete supplier">✕</button>
                      )}
                    </div>
                  </div>

                  <dl className="flex flex-col gap-2 m-0 mb-3">
                    <StatLine label="Purchases" value={rupees(s.total)} />
                    <StatLine label="Steel (Net)" value={kg(s.qty)} />
                    {/* <StatLine label="Transport" value={rupees(s.transportCost)} /> */}
                    <StatLine label="Loads" value={String(s.loads)} />
                  </dl>

                  <div className="h-[5px] rounded-full bg-line-soft overflow-hidden">
                    <div className="h-full bg-steel rounded-full" style={{ width: `${(s.total / cards.max) * 100}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Detail panel */}
      {selected && detail && (
        <div className="bg-surface border border-line rounded-md shadow-card p-5">
          <div className="flex items-baseline justify-between gap-2 flex-wrap mb-4">
            <h3 className="text-base font-semibold m-0">{selected.name}</h3>
            <span className="text-[12.5px] text-ink-faint">
              {period.month ? NEPALI_MONTHS_EN[period.month - 1] : "All months"} {period.year}
            </span>
          </div>
          <p className="text-[13px] text-ink-soft m-0 mb-4">
            Contact: {selected.contact || "—"} · Phone: {selected.phone || "—"}
          </p>

          <div className="grid grid-cols-4 gap-3 mb-[18px] max-[980px]:grid-cols-2 max-[520px]:grid-cols-1">
            <StatBox label="Purchases (Period)"      value={rupees(detail.total)} />
            <StatBox label="Steel Bought (Net)"      value={kg(detail.qty)} />
            <StatBox label="Number of Loads"         value={String(detail.loads)} />
            <StatBox label="Transportation Cost"     value={rupees(detail.transportCost)} />
            <StatBox label="Advance Given (All-Time)" value={rupees(detail.advance)} />
            <StatBox
              label={detail.due > 0 ? "Due to Supplier (All-Time)" : "Paid Ahead (All-Time)"}
              value={rupees(detail.due > 0 ? detail.due : detail.advance - detail.billed)}
            />
          </div>

          <div className="overflow-x-auto border border-line rounded-md bg-surface">
            <table className="w-full border-collapse min-w-[800px]">
              <thead>
                <tr>
                  {["Date","Invoice","Material","Gross Qty","Dust","Net Qty","Rate","Total","Transport","Status"].map((h) => (
                    <th key={h} className={`text-[11.5px] uppercase tracking-[0.04em] text-ink-faint font-semibold px-4 py-[11px] border-b border-line whitespace-nowrap ${/(Qty|Rate|Total|Transport)$/.test(h) ? "text-right tabular-nums" : "text-left"}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {detail.rows.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="text-center text-ink-faint py-7 text-[13.5px]">
                      No purchases from this supplier in the selected period.
                    </td>
                  </tr>
                ) : (
                  [...detail.rows]
                    .sort((a, b) =>
                      b.date_bs_year - a.date_bs_year ||
                      b.date_bs_month - a.date_bs_month ||
                      b.date_bs_day - a.date_bs_day
                    )
                    .map((p) => {
                      const t = filteredTransport.find((x) => Number(x.purchase_id) === Number(p.id));
                      return (
                        <tr key={p.id} className="transition-colors hover:bg-surface-sunken">
                          <td className="px-4 py-[11px] border-b border-line-soft text-[13.5px] whitespace-nowrap np">{bsStr(p)}</td>
                          <td className="px-4 py-[11px] border-b border-line-soft text-[13.5px] whitespace-nowrap">{p.invoice}</td>
                          <td className="px-4 py-[11px] border-b border-line-soft text-[13.5px] whitespace-nowrap">{p.material}</td>
                          <td className="px-4 py-[11px] border-b border-line-soft text-[13.5px] whitespace-nowrap text-right tabular-nums">{kg(p.gross_qty)}</td>
                          <td className="px-4 py-[11px] border-b border-line-soft text-[13.5px] whitespace-nowrap text-right tabular-nums">{kg(p.dust_qty)}</td>
                          <td className="px-4 py-[11px] border-b border-line-soft text-[13.5px] whitespace-nowrap text-right tabular-nums">{kg(p.net_qty)}</td>
                          <td className="px-4 py-[11px] border-b border-line-soft text-[13.5px] whitespace-nowrap text-right tabular-nums">{rupees(p.rate)}/kg</td>
                          <td className="px-4 py-[11px] border-b border-line-soft text-[13.5px] whitespace-nowrap text-right tabular-nums">{rupees(p.total)}</td>
                          <td className="px-4 py-[11px] border-b border-line-soft text-[13.5px] whitespace-nowrap text-right tabular-nums">
                            {t ? rupees(num(t.fee) + num(t.labor_charge) + num(t.road_expense) + num(t.tax_gbse)) : "—"}
                          </td>
                          <td className="px-4 py-[11px] border-b border-line-soft text-[13.5px] whitespace-nowrap">
                            <Badge variant={p.status === "Delivered" ? "positive" : "warning"}>{p.status}</Badge>
                          </td>
                        </tr>
                      );
                    })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Create / edit modal */}
      {showForm && (
        <Modal
          title={editing ? "Edit Supplier" : "New Supplier"}
          onClose={() => setShowForm(false)}
          footer={
            <>
              <Button onClick={() => setShowForm(false)} disabled={saving}>Cancel</Button>
              <Button variant="primary" type="submit" form="supplier-form" disabled={saving}>
                {saving ? "Saving…" : editing ? "Save Changes" : "Add Supplier"}
              </Button>
            </>
          }
        >
          <form id="supplier-form" onSubmit={save}>
            {formError && (
              <div className="mb-4 text-sm text-negative bg-negative-tint border border-negative-tint rounded-md px-3 py-2">
                {formError}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3.5 max-[560px]:grid-cols-1">
              <Field label="Name" span={2}>
                <input className={inputCls} value={form.name} autoFocus required
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Himal Steel Industries" />
              </Field>
              <Field label="Contact Person">
                <input className={inputCls} value={form.contact}
                  onChange={(e) => setForm((f) => ({ ...f, contact: e.target.value }))}
                  placeholder="e.g. Deepak Agrawal" />
              </Field>
              <Field label="Phone">
                <input className={inputCls} value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  placeholder="98XXXXXXXX" />
              </Field>
              <Field label="Type" span={2}>
                <select className={selectCls} value={form.type}
                  onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}>
                  <option value="main">Main</option>
                  <option value="small">Small</option>
                </select>
              </Field>
            </div>
          </form>
        </Modal>
      )}

      {toDelete && (
        <ConfirmDialog
          title="Delete supplier?"
          message={`Delete "${toDelete.name}"? Past purchases from this supplier are preserved.`}
          onCancel={() => setToDelete(null)}
          onConfirm={confirmDelete}
          busy={deleting}
        />
      )}
    </>
  );
}

/* ---------- Small presentational helpers ---------- */
function StatLine({ label, value }) {
  return (
    <div className="flex items-baseline justify-between gap-2.5">
      <dt className="text-ink-faint text-[12.5px]">{label}</dt>
      <dd className="m-0 font-semibold text-[12.5px] tabular-nums">{value}</dd>
    </div>
  );
}

function StatBox({ label, value }) {
  return (
    <div className="bg-surface-sunken border border-line-soft rounded-sm px-3.5 py-[13px]">
      <div className="text-[11.5px] text-ink-faint mb-1.5">{label}</div>
      <div className="text-base font-semibold tabular-nums">{value}</div>
    </div>
  );
}
/* ==========================================================================
   OfficeExpenses.jsx — day-to-day expense slips.
   Each slip holds N line items { description, amount }, added dynamically.
   Click a row to view + print the A4 expense slip.
   ========================================================================== */
import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import {
  Button, Modal, Field, ConfirmDialog, PageHeader, inputCls,
} from "../components/ui";
import DataTable from "../components/DataTable";
import { printVoucher } from "../lib/printVoucher";
import { bsToday, bsToAdString, adToBs, formatBs } from "../lib/nepali-date";

const todayBs = bsToday();

const EMPTY_FORM = {
  date_bs_year:  todayBs.year,
  date_bs_month: todayBs.month,
  date_bs_day:   todayBs.day,
  date_ad:       bsToAdString(todayBs),
  company: "ASN Demolition Pvt.Ltd",
  note: "",
  items: [{ description: "", amount: "" }],
};

const num = (v) => { const n = Number(v); return isFinite(n) ? n : 0; };
const rupees = (v) => `Rs. ${num(v).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
);

export default function OfficeExpenses() {
  const { has, canDelete } = useAuth();
  const canCreate = has("office_expenses", "create");
  const canUpdate = has("office_expenses", "update");
  const canDel    = canDelete("office_expenses");

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const [detail, setDetail] = useState(null);

  const [toDelete, setToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  async function load() {
    setLoading(true); setError(null);
    try {
      const { items } = await api.get("/api/office-expenses");
      setRows(items || []);
    } catch (e) {
      setError(e.message || "Failed to load office expenses");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (!q) return true;
      const inItems = (r.items || []).some((it) => it.description?.toLowerCase().includes(q));
      return r.note?.toLowerCase().includes(q) || inItems;
    });
  }, [rows, search]);

  const stats = useMemo(() => {
    const total = rows.reduce((s, r) => s + num(r.total), 0);
    const itemCount = rows.reduce((s, r) => s + (r.items?.length || 0), 0);
    const avg = rows.length ? total / rows.length : 0;
    return [
      { label: "Total Expenses", value: rupees(total) },
      { label: "Slips Logged",   value: String(rows.length) },
      { label: "Line Items",     value: String(itemCount) },
      { label: "Average per Slip", value: rupees(Math.round(avg)) },
    ];
  }, [rows]);

  // Live "date_ad" preview when BS changes
  useEffect(() => {
    if (!showForm) return;
    const y = Number(form.date_bs_year);
    const m = Number(form.date_bs_month);
    const d = Number(form.date_bs_day);
    if (y && m && d) {
      try {
        const adStr = bsToAdString({ year: y, month: m, day: d });
        if (adStr !== form.date_ad) setForm((f) => ({ ...f, date_ad: adStr }));
      } catch { /* invalid BS combo */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.date_bs_year, form.date_bs_month, form.date_bs_day, showForm]);

  function addItem() {
    setForm((f) => ({ ...f, items: [...f.items, { description: "", amount: "" }] }));
  }
  function removeItem(i) {
    setForm((f) => {
      const next = f.items.filter((_, idx) => idx !== i);
      return { ...f, items: next.length ? next : [{ description: "", amount: "" }] };
    });
  }
  function updateItem(i, patch) {
    setForm((f) => ({
      ...f,
      items: f.items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)),
    }));
  }

  const computedTotal = useMemo(
    () => form.items.reduce((s, it) => s + num(it.amount), 0),
    [form.items]
  );

  function openCreate() {
    setEditing(null);
    setForm({ ...EMPTY_FORM, items: [{ description: "", amount: "" }] });
    setFormError(null);
    setShowForm(true);
  }
  function openEdit(row) {
    setEditing(row);
    setForm({
      date_bs_year: row.date_bs_year,
      date_bs_month: row.date_bs_month,
      date_bs_day: row.date_bs_day,
      date_ad: row.date_ad ? String(row.date_ad).slice(0, 10) : bsToAdString(bsToday()),
      company: row.company || "",
      note: row.note || "",
      items: (row.items && row.items.length
        ? row.items.map((it) => ({ description: it.description, amount: String(it.amount) }))
        : [{ description: "", amount: "" }]),
    });
    setFormError(null);
    setShowForm(true);
  }

  async function save(e) {
    e.preventDefault(); setSaving(true); setFormError(null);
    try {
      const items = form.items
        .map((it) => ({ description: (it.description || "").trim(), amount: num(it.amount) }))
        .filter((it) => it.description && it.amount > 0);

      if (!items.length) {
        setFormError("Add at least one line item with a description and amount.");
        return;
      }

      const payload = {
        date_bs_year: Number(form.date_bs_year),
        date_bs_month: Number(form.date_bs_month),
        date_bs_day: Number(form.date_bs_day),
        date_ad: form.date_ad,
        company: form.company.trim() || undefined,
        note: form.note.trim() || undefined,
        items,
      };

      if (editing) {
        await api.patch(`/api/office-expenses/${editing.id}`, {
          company: payload.company,
          note: payload.note,
        });
      } else {
        await api.post("/api/office-expenses", payload);
      }
      setShowForm(false);
      await load();
    } catch (e) {
      setFormError(e.message || "Could not save expense");
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await api.del(`/api/office-expenses/${toDelete.id}`);
      setToDelete(null);
      await load();
    } catch (e) {
      alert(e.message || "Could not delete expense");
    } finally {
      setDeleting(false);
    }
  }

  /* ---------- Print ---------- */
  function printOfficeExpense(row) {
    const company = row.company || "ASN Demolition Pvt.Ltd";
    const html = `
      <div class="voucher-sheet">
        <div class="voucher-head">
          <div class="voucher-brand">${esc(company)}</div>
          <div class="voucher-title">Office Expense Slip</div>
        </div>
        <div class="voucher-meta">
          <div>Slip No.<strong>${esc(row.id)}</strong></div>
          <div>Date<strong>${esc(formatBs(row))} (${esc(row.date_ad ? String(row.date_ad).slice(0, 10) : "-")})</strong></div>
          <div>Company<strong>${esc(company)}</strong></div>
        </div>
        <table class="voucher-table">
          <thead>
            <tr><th>Description</th><th>Amount</th></tr>
          </thead>
          <tbody>
            ${(row.items || []).map((i) => `
              <tr>
                <td>${esc(i.description)}</td>
                <td>${esc(rupees(i.amount))}</td>
              </tr>`).join("")}
            <tr class="voucher-amount-row">
              <td>Total</td>
              <td>${esc(rupees(row.total))}</td>
            </tr>
          </tbody>
        </table>
        ${row.note ? `<p style="font-size:12.5px;color:#444;">Note: ${esc(row.note)}</p>` : ""}
        <div class="voucher-signatures">
          <div>Prepared By</div>
          <div>Approved By</div>
        </div>
        <div class="voucher-foot">Printed from ${esc(company)} management system.</div>
      </div>`;
    printVoucher(html);
  }

  /* ---------- Table columns ---------- */
  const columns = [
    { key: "date_bs", label: "Date (BS)", render: (r) => formatBs(r) },
    { key: "date_ad", label: "Date (EN)", render: (r) => r.date_ad ? String(r.date_ad).slice(0, 10) : "—" },
    { key: "company", label: "Company", render: (r) => r.company || "—" },
    { key: "items", label: "Items", render: (r) => {
      const summary = (r.items || []).map((i) => i.description).join(", ");
      return summary.length > 60 ? summary.slice(0, 57) + "…" : summary || "—";
    } },
    { key: "count", label: "Lines", numeric: true, render: (r) => (r.items || []).length },
    { key: "total", label: "Total", numeric: true, render: (r) => rupees(r.total) },
    { key: "note", label: "Note", render: (r) => r.note || "—" },
    { key: "actions", label: "", render: (r) => (
      <div className="flex gap-1.5 justify-end">
        {canUpdate && (
          <button type="button" onClick={(e) => { e.stopPropagation(); openEdit(r); }}
            className="text-steel text-xs hover:underline">Edit</button>
        )}
        {canDel && (
          <button type="button" onClick={(e) => { e.stopPropagation(); setToDelete(r); }}
            className="text-negative text-xs hover:underline">Delete</button>
        )}
      </div>
    ) },
  ];

  return (
    <>
      <PageHeader
        title="Office Expenses"
        description="Day-to-day expenses — kitchen, repairs, water, and anything else"
        actions={canCreate ? <Button variant="primary" onClick={openCreate}>+ Add Expense</Button> : null}
      />

      <div className="grid grid-cols-4 gap-3 mb-[18px] max-[980px]:grid-cols-2 max-[520px]:grid-cols-1">
        {stats.map((s, i) => (
          <div key={i} className="bg-surface-sunken border border-line-soft rounded-sm px-3.5 py-[13px]">
            <div className="text-[11.5px] text-ink-faint mb-1.5">{s.label}</div>
            <div className="text-base font-semibold tabular-nums">{s.value}</div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 flex-wrap bg-surface border border-line rounded-md p-2.5 mb-6">
        <label htmlFor="oe-search" className="text-xs text-ink-faint pl-1">Search</label>
        <input id="oe-search" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Description or note" className={inputCls + " !w-64"} />
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
        <div className="text-ink-faint text-sm py-8 text-center">Loading expenses…</div>
      ) : (
        <DataTable
          columns={columns}
          rows={filtered}
          onRowClick={(row) => setDetail(row)}
          emptyMessage={
            rows.length === 0
              ? (canCreate ? 'No expenses yet — click "+ Add Expense" to get started.' : "No expenses yet.")
              : "No expenses match the current filter."
          }
        />
      )}

      {/* Detail modal — view + print */}
      {detail && (
        <Modal
          title={`Office Expense — ${formatBs(detail)}`}
          onClose={() => setDetail(null)}
          wide
          footer={
            <>
              <Button onClick={() => printOfficeExpense(detail)}>Print</Button>
              <Button onClick={() => setDetail(null)}>Close</Button>
            </>
          }
        >
          <div className="grid grid-cols-2 gap-x-5 gap-y-2.5 mb-4 max-[560px]:grid-cols-1">
            <DetailPair label="Company" value={detail.company || "—"} />
            <DetailPair label="Date (EN)" value={detail.date_ad ? String(detail.date_ad).slice(0, 10) : "—"} />
          </div>

          <div className="overflow-x-auto border border-line rounded-md bg-surface mb-4">
            <table className="w-full border-collapse table-fixed">
              <thead>
                <tr>
                  <th className="text-[11.5px] uppercase tracking-[0.04em] text-ink-faint font-semibold text-left px-4 py-[11px] border-b border-line">
                    Description
                  </th>
                  <th className="text-[11.5px] uppercase tracking-[0.04em] text-ink-faint font-semibold text-right px-4 py-[11px] border-b border-line w-40">
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody>
                {(detail.items || []).length === 0 ? (
                  <tr>
                    <td colSpan={2} className="text-center text-ink-faint py-6 text-[13px]">
                      No line items on this slip.
                    </td>
                  </tr>
                ) : (
                  detail.items.map((it, i) => (
                    <tr key={i} className="transition-colors hover:bg-surface-sunken">
                      <td className="px-4 py-[11px] border-b border-line-soft text-[13.5px]">
                        {it.description}
                      </td>
                      <td className="px-4 py-[11px] border-b border-line-soft text-[13.5px] text-right tabular-nums">
                        {rupees(it.amount)}
                      </td>
                    </tr>
                  ))
                )}
                <tr>
                  <td className="px-4 py-[11px] border-t border-line text-[13.5px] font-semibold">
                    Total
                  </td>
                  <td className="px-4 py-[11px] border-t border-line text-[13.5px] font-semibold text-right tabular-nums">
                    {rupees(detail.total)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="grid grid-cols-2 gap-x-5 gap-y-2.5 max-[560px]:grid-cols-1">
            <DetailPair label="Note" value={detail.note || "—"} />
          </div>
        </Modal>
      )}

      {/* Create / edit modal */}
      {showForm && (
        <Modal
          title={editing ? "Edit Office Expense" : "New Office Expense"}
          onClose={() => setShowForm(false)}
          wide
          footer={
            <>
              <Button onClick={() => setShowForm(false)} disabled={saving}>Cancel</Button>
              <Button variant="primary" type="submit" form="oe-form" disabled={saving}>
                {saving ? "Saving…" : editing ? "Save Changes" : "Save Expense"}
              </Button>
            </>
          }
        >
          <form id="oe-form" onSubmit={save}>
            {formError && (
              <div className="mb-4 text-sm text-negative bg-negative-tint border border-negative-tint rounded-md px-3 py-2">
                {formError}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3.5 mb-5 max-[560px]:grid-cols-1">
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
              <Field label="Date (AD)" hint="auto-computed from BS">
                <input type="date" className={inputCls} value={form.date_ad}
                  onChange={(e) => {
                    const ad = e.target.value;
                    setForm((f) => ({ ...f, date_ad: ad }));
                    try {
                      const d = new Date(ad);
                      if (!isNaN(d)) {
                        const bs = adToBs(d);
                        setForm((f) => ({ ...f, date_bs_year: bs.year, date_bs_month: bs.month, date_bs_day: bs.day, date_ad: ad }));
                      }
                    } catch { /* ignore */ }
                  }} />
              </Field>
              <Field label="Company" span={2}>
                <input className={inputCls} value={form.company}
                  onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))} />
              </Field>
            </div>

            <h4 className="text-[13.5px] font-semibold mb-3 pt-4 border-t border-dashed border-line">
              Line Items
            </h4>
            <div className="flex flex-col gap-2 mb-3">
              {form.items.map((it, i) => (
                <div key={i} className="grid grid-cols-[1fr_140px_34px] gap-2 items-center">
                  <input className={inputCls} placeholder="Description (e.g. Kitchen)"
                    value={it.description}
                    onChange={(e) => updateItem(i, { description: e.target.value })} />
                  <input className={inputCls} type="number" min="0" step="0.01" placeholder="Amount"
                    value={it.amount}
                    onChange={(e) => updateItem(i, { amount: e.target.value })} />
                  <button type="button" onClick={() => removeItem(i)}
                    className="text-ink-faint hover:text-negative w-[34px] h-[34px] rounded-sm border border-transparent hover:border-negative-tint hover:bg-negative-tint flex items-center justify-center text-sm"
                    title="Remove row">✕</button>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between gap-2 mb-4">
              <Button onClick={addItem} size="sm">+ Add Row</Button>
              <div className="text-[13.5px] font-semibold">
                Total: <span className="text-steel-dark">{rupees(computedTotal)}</span>
              </div>
            </div>

            <Field label="Note (optional)" span={2}>
              <input className={inputCls} value={form.note}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                placeholder="Anything worth remembering about this slip" />
            </Field>
          </form>
        </Modal>
      )}

      {toDelete && (
        <ConfirmDialog
          title="Delete expense slip?"
          message="Delete this office expense slip? This can't be undone."
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
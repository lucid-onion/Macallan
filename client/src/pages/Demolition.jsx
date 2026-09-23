/* ==========================================================================
   Demolition.jsx — demolition job slips.
   Each job has: date, company, site, transport_fee, and N line items
   { description, quantity, rate, amount } where amount = quantity × rate.
   ========================================================================== */
import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import {
  Button, Modal, Field, ConfirmDialog, PageHeader,
  inputCls, selectCls,
} from "../components/ui";
import DataTable from "../components/DataTable";

const today = new Date();

const EMPTY_FORM = {
  date_bs_year: 2082,
  date_bs_month: 1,
  date_bs_day: 1,
  date_ad: today.toISOString().slice(0, 10),
  company: "ASN Demolition Pvt.Ltd",
  site: "",
  transport_fee: "0",
  note: "",
  items: [{ description: "Labor", quantity: "", rate: "" }],
};

function num(v) { const n = Number(v); return isFinite(n) ? n : 0; }

export default function Demolition() {
  const { has } = useAuth();
  const canCreate = has("demolition", "create");
  const canUpdate = has("demolition", "update");
  const canDelete = has("demolition", "delete");

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [search, setSearch] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);

  const [toDelete, setToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  async function load() {
    setLoading(true); setError(null);
    try {
      const { items } = await api.get("/api/demolition");
      setRows(items);
    } catch (e) {
      setError(e.message || "Failed to load demolition jobs");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (!q) return true;
      const inItems = (r.items || []).some(it => it.description?.toLowerCase().includes(q));
      return r.site?.toLowerCase().includes(q) ||
             r.note?.toLowerCase().includes(q) ||
             inItems;
    });
  }, [rows, search]);

  const stats = useMemo(() => {
    const total = rows.reduce((s, r) => s + num(r.total), 0);
    const transport = rows.reduce((s, r) => s + num(r.transport_fee), 0);
    const avg = rows.length ? total / rows.length : 0;
    return [
      { label: "Total",        value: `Rs. ${total.toLocaleString("en-IN")}` },
      { label: "Jobs Logged",  value: String(rows.length) },
      { label: "Transport Cost", value: `Rs. ${transport.toLocaleString("en-IN")}` },
      { label: "Average per Job", value: `Rs. ${Math.round(avg).toLocaleString("en-IN")}` },
    ];
  }, [rows]);

  // ---- Row helpers ------------------------------------------------------
  function addItem() {
    setForm(f => ({ ...f, items: [...f.items, { description: "", quantity: "", rate: "" }] }));
  }
  function removeItem(i) {
    setForm(f => {
      const next = f.items.filter((_, idx) => idx !== i);
      return { ...f, items: next.length ? next : [{ description: "", quantity: "", rate: "" }] };
    });
  }
  function updateItem(i, patch) {
    setForm(f => ({ ...f, items: f.items.map((it, idx) => idx === i ? { ...it, ...patch } : it) }));
  }

  const computed = useMemo(() => {
    const itemAmounts = form.items.map(it => num(it.quantity) * num(it.rate));
    const expenseTotal = itemAmounts.reduce((s, n) => s + n, 0);
    const transportFee = num(form.transport_fee);
    return { itemAmounts, expenseTotal, transportFee, grandTotal: expenseTotal + transportFee };
  }, [form.items, form.transport_fee]);

  // ---- Open / save ------------------------------------------------------
  function openCreate() {
    setEditing(null);
    setForm({ ...EMPTY_FORM, items: [{ description: "Labor", quantity: "", rate: "" }] });
    setFormError(null);
    setShowForm(true);
  }
  function openEdit(row) {
    setEditing(row);
    setForm({
      date_bs_year: row.date_bs_year || 2082,
      date_bs_month: row.date_bs_month || 1,
      date_bs_day: row.date_bs_day || 1,
      date_ad: row.date_ad ? String(row.date_ad).slice(0, 10) : today.toISOString().slice(0, 10),
      company: row.company || "",
      site: row.site || "",
      transport_fee: String(row.transport_fee ?? "0"),
      note: row.note || "",
      items: (row.items && row.items.length
        ? row.items.map(it => ({
            description: it.description,
            quantity: String(it.quantity ?? ""),
            rate: String(it.rate ?? ""),
          }))
        : [{ description: "Labor", quantity: "", rate: "" }]),
    });
    setFormError(null);
    setShowForm(true);
  }

  async function save(e) {
    e.preventDefault(); setSaving(true); setFormError(null);
    try {
      const items = form.items
        .map(it => {
          const q = num(it.quantity), r = num(it.rate);
          return {
            description: (it.description || "").trim(),
            quantity: q,
            rate: r,
            amount: q * r,
          };
        })
        .filter(it => it.description && it.amount > 0);

      const transportFee = num(form.transport_fee);
      if (!items.length && transportFee <= 0) {
        setFormError("Add at least one expense row with a value, or enter a transport fee.");
        return;
      }

      const payload = {
        date_bs_year: Number(form.date_bs_year),
        date_bs_month: Number(form.date_bs_month),
        date_bs_day: Number(form.date_bs_day),
        date_ad: form.date_ad,
        company: form.company.trim() || undefined,
        site: form.site.trim() || undefined,
        transport_fee: transportFee,
        note: form.note.trim() || undefined,
        items,
      };

      if (editing) {
        // Server only accepts parent updates for now.
        await api.patch(`/api/demolition/${editing.id}`, {
          company: payload.company,
          site: payload.site,
          transport_fee: payload.transport_fee,
          note: payload.note,
        });
      } else {
        await api.post("/api/demolition", payload);
      }
      setShowForm(false);
      await load();
    } catch (e) {
      setFormError(e.message || "Could not save demolition job");
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await api.del(`/api/demolition/${toDelete.id}`);
      setToDelete(null);
      await load();
    } catch (e) {
      alert(e.message || "Could not delete job");
    } finally {
      setDeleting(false);
    }
  }

  const columns = [
    { key: "date_bs", label: "Date (BS)",
      render: (r) => `${r.date_bs_year}/${String(r.date_bs_month).padStart(2, "0")}/${String(r.date_bs_day).padStart(2, "0")}` },
    { key: "date_ad", label: "Date (EN)",
      render: (r) => r.date_ad ? String(r.date_ad).slice(0, 10) : "—" },
    { key: "company", label: "Company", render: (r) => r.company || "—" },
    { key: "site", label: "Site", render: (r) => r.site || "—" },
    { key: "items", label: "Items",
      render: (r) => {
        const summary = (r.items || []).map(i => `${i.description} (${num(i.amount).toLocaleString("en-IN")})`).join(", ");
        return summary.length > 60 ? summary.slice(0, 57) + "…" : summary || "—";
      } },
    { key: "transport_fee", label: "Transport", numeric: true,
      render: (r) => `Rs. ${num(r.transport_fee).toLocaleString("en-IN")}` },
    { key: "total", label: "Total", numeric: true,
      render: (r) => `Rs. ${num(r.total).toLocaleString("en-IN")}` },
    { key: "actions", label: "",
      render: (r) => (
        <div className="flex gap-1.5 justify-end">
          {canUpdate && (
            <button type="button" onClick={(e) => { e.stopPropagation(); openEdit(r); }}
              className="text-steel text-xs hover:underline">Edit</button>
          )}
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
        title="Demolition"
        description="Demolition jobs — a transport fee plus a labor/expense breakdown per job"
        actions={canCreate ? <Button variant="primary" onClick={openCreate}>+ Add Demolition</Button> : null}
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
        <label htmlFor="dm-search" className="text-xs text-ink-faint pl-1">Search</label>
        <input id="dm-search" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Site, item description, note" className={inputCls + " !w-64"} />
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
        <div className="text-ink-faint text-sm py-8 text-center">Loading demolition jobs…</div>
      ) : (
        <DataTable
          columns={columns}
          rows={filtered}
          emptyMessage={
            rows.length === 0
              ? (canCreate ? 'No demolition jobs yet — click "+ Add Demolition" to get started.' : "No jobs yet.")
              : "No jobs match the current filter."
          }
        />
      )}

      {showForm && (
        <Modal
          title={editing ? "Edit Demolition Job" : "New Demolition Job"}
          onClose={() => setShowForm(false)}
          wide
          footer={
            <>
              <Button onClick={() => setShowForm(false)} disabled={saving}>Cancel</Button>
              <Button variant="primary" type="submit" form="dm-form" disabled={saving}>
                {saving ? "Saving…" : editing ? "Save Changes" : "Save Job"}
              </Button>
            </>
          }
        >
          <form id="dm-form" onSubmit={save}>
            {formError && (
              <div className="mb-4 text-sm text-negative bg-negative-tint border border-negative-tint rounded-md px-3 py-2">
                {formError}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3.5 mb-5 max-[560px]:grid-cols-1">
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
              <Field label="Company" span={2}>
                <input className={inputCls} value={form.company}
                  onChange={(e) => setForm(f => ({ ...f, company: e.target.value }))} />
              </Field>
              <Field label="Site / Address" span={2}>
                <input className={inputCls} value={form.site}
                  onChange={(e) => setForm(f => ({ ...f, site: e.target.value }))}
                  placeholder="e.g. House demolition — Balkot" />
              </Field>
            </div>

            <h4 className="text-[13.5px] font-semibold mb-3 pt-4 border-t border-dashed border-line">
              Transport
            </h4>
            <div className="grid grid-cols-2 gap-3.5 mb-5 max-[560px]:grid-cols-1">
              <Field label="Transport Fee (Rs)">
                <input type="number" min="0" step="0.01" className={inputCls} value={form.transport_fee}
                  onChange={(e) => setForm(f => ({ ...f, transport_fee: e.target.value }))} />
              </Field>
            </div>

            <h4 className="text-[13.5px] font-semibold mb-3 pt-4 border-t border-dashed border-line">
              Expense Items (Amount = Quantity × Rate)
            </h4>
            <div className="flex flex-col gap-2 mb-3">
              {form.items.map((it, i) => (
                <div key={i} className="grid grid-cols-[1fr_100px_110px_120px_34px] gap-2 items-center max-[760px]:grid-cols-[1fr_80px_90px_100px_34px]">
                  <input className={inputCls} placeholder="Description"
                    value={it.description}
                    onChange={(e) => updateItem(i, { description: e.target.value })} />
                  <input className={inputCls} type="number" min="0" step="0.01" placeholder="Qty"
                    value={it.quantity}
                    onChange={(e) => updateItem(i, { quantity: e.target.value })} />
                  <input className={inputCls} type="number" min="0" step="0.01" placeholder="Rate"
                    value={it.rate}
                    onChange={(e) => updateItem(i, { rate: e.target.value })} />
                  <div className={inputCls + " !bg-surface-sunken !text-ink-soft font-semibold text-right"}>
                    {computed.itemAmounts[i].toLocaleString("en-IN")}
                  </div>
                  <button type="button" onClick={() => removeItem(i)}
                    className="text-ink-faint hover:text-negative w-[34px] h-[34px] rounded-sm border border-transparent hover:border-negative-tint hover:bg-negative-tint flex items-center justify-center text-sm"
                    title="Remove row">✕</button>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between gap-2 mb-4">
              <Button onClick={addItem} size="sm">+ Add Row</Button>
              <div className="text-[13.5px]">
                Expense total: <strong>Rs. {computed.expenseTotal.toLocaleString("en-IN")}</strong>
                {" · "}
                Transport: <strong>Rs. {computed.transportFee.toLocaleString("en-IN")}</strong>
                {" · "}
                <span className="text-steel-dark">Grand total: Rs. {computed.grandTotal.toLocaleString("en-IN")}</span>
              </div>
            </div>

            <Field label="Note (optional)" span={2}>
              <input className={inputCls} value={form.note}
                onChange={(e) => setForm(f => ({ ...f, note: e.target.value }))} />
            </Field>
          </form>
        </Modal>
      )}

      {toDelete && (
        <ConfirmDialog
          title="Delete demolition job?"
          message="Delete this demolition job slip? This can't be undone."
          onCancel={() => setToDelete(null)}
          onConfirm={confirmDelete}
          busy={deleting}
        />
      )}
    </>
  );
}
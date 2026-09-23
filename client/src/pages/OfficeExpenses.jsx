/* ==========================================================================
   OfficeExpenses.jsx — daily office expense slips.
   Each slip holds N line items { description, amount }, added dynamically.
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
  note: "",
  items: [{ description: "", amount: "" }],
};

function num(v) { const n = Number(v); return isFinite(n) ? n : 0; }

export default function OfficeExpenses() {
  const { has } = useAuth();
  const canCreate = has("office_expenses", "create");
  const canUpdate = has("office_expenses", "update");
  const canDelete = has("office_expenses", "delete");

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
      const { items } = await api.get("/api/office-expenses");
      setRows(items);
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
      const inItems = (r.items || []).some(it => it.description?.toLowerCase().includes(q));
      return r.note?.toLowerCase().includes(q) || inItems;
    });
  }, [rows, search]);

  const stats = useMemo(() => {
    const total = rows.reduce((s, r) => s + num(r.total), 0);
    const itemCount = rows.reduce((s, r) => s + (r.items?.length || 0), 0);
    const avg = rows.length ? total / rows.length : 0;
    return [
      { label: "Total Expenses", value: `Rs. ${total.toLocaleString("en-IN")}` },
      { label: "Slips Logged",   value: String(rows.length) },
      { label: "Line Items",     value: String(itemCount) },
      { label: "Average per Slip", value: `Rs. ${Math.round(avg).toLocaleString("en-IN")}` },
    ];
  }, [rows]);

  // ---- Items helpers ----------------------------------------------------
  function addItem() {
    setForm(f => ({ ...f, items: [...f.items, { description: "", amount: "" }] }));
  }
  function removeItem(i) {
    setForm(f => {
      const next = f.items.filter((_, idx) => idx !== i);
      return { ...f, items: next.length ? next : [{ description: "", amount: "" }] };
    });
  }
  function updateItem(i, patch) {
    setForm(f => ({ ...f, items: f.items.map((it, idx) => idx === i ? { ...it, ...patch } : it) }));
  }

  const computedTotal = useMemo(
    () => form.items.reduce((s, it) => s + num(it.amount), 0),
    [form.items]
  );

  // ---- Open / save ------------------------------------------------------
  function openCreate() {
    setEditing(null);
    setForm({ ...EMPTY_FORM, items: [{ description: "", amount: "" }] });
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
      note: row.note || "",
      items: (row.items && row.items.length
        ? row.items.map(it => ({ description: it.description, amount: String(it.amount) }))
        : [{ description: "", amount: "" }]),
    });
    setFormError(null);
    setShowForm(true);
  }

  async function save(e) {
    e.preventDefault(); setSaving(true); setFormError(null);
    try {
      const items = form.items
        .map(it => ({ description: (it.description || "").trim(), amount: num(it.amount) }))
        .filter(it => it.description && it.amount > 0);

      if (!items.length) { setFormError("Add at least one line item with a description and amount."); return; }

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
        // Server supports updating parent fields only (company/note) for now;
        // items are treated as immutable once saved. Tell the user.
        if (editing) {
          await api.patch(`/api/office-expenses/${editing.id}`, {
            company: payload.company,
            note: payload.note,
          });
        }
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

  const columns = [
    { key: "date_bs", label: "Date (BS)",
      render: (r) => `${r.date_bs_year}/${String(r.date_bs_month).padStart(2, "0")}/${String(r.date_bs_day).padStart(2, "0")}` },
    { key: "date_ad", label: "Date (EN)",
      render: (r) => r.date_ad ? String(r.date_ad).slice(0, 10) : "—" },
    { key: "company", label: "Company", render: (r) => r.company || "—" },
    { key: "items", label: "Items",
      render: (r) => {
        const summary = (r.items || []).map(i => i.description).join(", ");
        return summary.length > 60 ? summary.slice(0, 57) + "…" : summary || "—";
      } },
    { key: "count", label: "Lines", numeric: true,
      render: (r) => (r.items || []).length },
    { key: "total", label: "Total", numeric: true,
      render: (r) => `Rs. ${num(r.total).toLocaleString("en-IN")}` },
    { key: "note", label: "Note", render: (r) => r.note || "—" },
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
          emptyMessage={
            rows.length === 0
              ? (canCreate ? 'No expenses yet — click "+ Add Expense" to get started.' : "No expenses yet.")
              : "No expenses match the current filter."
          }
        />
      )}

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
            </div>

            <h4 className="text-[13.5px] font-semibold mb-3 pt-4 border-t border-dashed border-line">
              Line Items
            </h4>
            <div className="flex flex-col gap-2 mb-3">
              {form.items.map((it, i) => (
                <div key={i} className="grid grid-cols-[1fr_140px_34px] gap-2 items-center">
                  <input
                    className={inputCls}
                    placeholder="Description (e.g. Kitchen)"
                    value={it.description}
                    onChange={(e) => updateItem(i, { description: e.target.value })}
                  />
                  <input
                    className={inputCls}
                    type="number" min="0" step="0.01"
                    placeholder="Amount"
                    value={it.amount}
                    onChange={(e) => updateItem(i, { amount: e.target.value })}
                  />
                  <button
                    type="button"
                    onClick={() => removeItem(i)}
                    className="text-ink-faint hover:text-negative w-[34px] h-[34px] rounded-sm border border-transparent hover:border-negative-tint hover:bg-negative-tint flex items-center justify-center text-sm"
                    title="Remove row"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between gap-2 mb-4">
              <Button onClick={addItem} size="sm">+ Add Row</Button>
              <div className="text-[13.5px] font-semibold">
                Total: <span className="text-steel-dark">Rs. {computedTotal.toLocaleString("en-IN")}</span>
              </div>
            </div>

            <Field label="Note (optional)" span={2}>
              <input className={inputCls} value={form.note}
                onChange={(e) => setForm(f => ({ ...f, note: e.target.value }))}
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
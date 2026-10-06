/* ==========================================================================
   Inventory.jsx — products with stock levels and extended product metadata.
   Reorder Level removed — no low-stock warnings.
   ========================================================================== */
import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import {
  Button, Modal, Field, ConfirmDialog, PageHeader,
  inputCls,
} from "../components/ui";
import DataTable from "../components/DataTable";

const EMPTY_FORM = {
  name: "",
  category: "",
  stock_kg: 0,
  estimated_price: "",
  contact_person: "",
  contact_phone: "",
  location: "",
  description: "",
};

const num = (v) => { const n = Number(v); return isFinite(n) ? n : 0; };
const rupees = (v) => `Rs. ${num(v).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export default function Inventory() {
  const { has, canDelete } = useAuth();
  const canCreate = has("inventory", "create");
  const canUpdate = has("inventory", "update");
  const canDel    = canDelete("inventory");

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
      const { items } = await api.get("/api/inventory");
      setRows(items || []);
    } catch (e) {
      setError(e.message || "Failed to load inventory");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      r.name?.toLowerCase().includes(q) ||
      r.category?.toLowerCase().includes(q) ||
      r.location?.toLowerCase().includes(q) ||
      r.contact_person?.toLowerCase().includes(q)
    );
  }, [rows, search]);

  const stats = useMemo(() => {
    const totalStock = rows.reduce((s, r) => s + Number(r.stock_kg || 0), 0);
    const categories = new Set(rows.map((r) => r.category)).size;
    const withPrice = rows.filter((r) => r.estimated_price != null).length;
    return [
      { label: "Total Products",   value: String(rows.length) },
      { label: "Total Stock",      value: `${totalStock.toLocaleString("en-IN")} kg` },
      { label: "Categories",       value: String(categories) },
      { label: "Products Priced",  value: `${withPrice} / ${rows.length}` },
    ];
  }, [rows]);

  function openCreate() {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setFormError(null);
    setShowForm(true);
  }

  function openEdit(row) {
    setEditing(row);
    setForm({
      name:            row.name || "",
      category:        row.category || "",
      stock_kg:        Number(row.stock_kg || 0),
      estimated_price: row.estimated_price ?? "",
      contact_person:  row.contact_person || "",
      contact_phone:   row.contact_phone || "",
      location:        row.location || "",
      description:     row.description || "",
    });
    setFormError(null);
    setShowForm(true);
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const payload = {
        name:            form.name.trim(),
        category:        form.category.trim(),
        stock_kg:        Number(form.stock_kg) || 0,
        estimated_price: form.estimated_price === "" ? null : Number(form.estimated_price),
        contact_person:  form.contact_person.trim() || undefined,
        contact_phone:   form.contact_phone.trim() || undefined,
        location:        form.location.trim() || undefined,
        description:     form.description.trim() || undefined,
      };
      if (!payload.name)     { setFormError("Name is required.");     setSaving(false); return; }
      if (!payload.category) { setFormError("Category is required."); setSaving(false); return; }

      if (editing) await api.patch(`/api/inventory/${editing.id}`, payload);
      else         await api.post(`/api/inventory`, payload);

      setShowForm(false);
      await load();
    } catch (e) {
      setFormError(e.message || "Could not save item");
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await api.del(`/api/inventory/${toDelete.id}`);
      setToDelete(null);
      await load();
    } catch (e) {
      alert(e.message || "Could not delete item");
    } finally {
      setDeleting(false);
    }
  }

  const columns = [
    { key: "name",     label: "Product" },
    { key: "category", label: "Category" },
    { key: "stock_kg", label: "Current Stock", numeric: true,
      render: (r) => `${Number(r.stock_kg).toLocaleString("en-IN")} kg` },
    { key: "estimated_price", label: "Est. Price", numeric: true,
      render: (r) => r.estimated_price == null
        ? <span className="text-ink-faint">—</span>
        : rupees(r.estimated_price) },
    { key: "location", label: "Location",
      render: (r) => r.location || <span className="text-ink-faint">—</span> },
    { key: "contact_person", label: "Contact",
      render: (r) => {
        if (!r.contact_person && !r.contact_phone) return <span className="text-ink-faint">—</span>;
        return (
          <span>
            {r.contact_person || "—"}
            {r.contact_phone ? <span className="text-ink-faint"> · {r.contact_phone}</span> : null}
          </span>
        );
      } },
    { key: "actions", label: "",
      render: (r) => (
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
        title="Inventory"
        description="Products and current stock levels"
        actions={canCreate ? <Button variant="primary" onClick={openCreate}>+ Add Product</Button> : null}
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
        <label htmlFor="inv-search" className="text-xs text-ink-faint pl-1">Search</label>
        <input id="inv-search" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Product, category, location, contact" className={inputCls + " !w-64"} />
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
        <div className="text-ink-faint text-sm py-8 text-center">Loading inventory…</div>
      ) : (
        <DataTable
          columns={columns}
          rows={filtered}
          emptyMessage={
            rows.length === 0
              ? (canCreate ? 'No products yet — click "+ Add Product" to get started.' : "No products yet.")
              : "No products match the current filter."
          }
        />
      )}

      {showForm && (
        <Modal
          title={editing ? "Edit Product" : "New Product"}
          onClose={() => setShowForm(false)}
          wide
          footer={
            <>
              <Button onClick={() => setShowForm(false)} disabled={saving}>Cancel</Button>
              <Button variant="primary" type="submit" form="inventory-form" disabled={saving}>
                {saving ? "Saving…" : editing ? "Save Changes" : "Add Product"}
              </Button>
            </>
          }
        >
          <form id="inventory-form" onSubmit={save}>
            {formError && (
              <div className="mb-4 text-sm text-negative bg-negative-tint border border-negative-tint rounded-md px-3 py-2">
                {formError}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3.5 mb-3.5 max-[560px]:grid-cols-1">
              <Field label="Product Name" span={2}>
                <input className={inputCls} value={form.name} autoFocus required
                  onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. TMT Rod 12mm" />
              </Field>

              <Field label="Category" span={2}>
                <input className={inputCls} value={form.category} required
                  onChange={(e) => setForm(f => ({ ...f, category: e.target.value }))}
                  placeholder="e.g. TMT Rod" />
              </Field>

              <Field label="Current Stock (kg)">
                <input type="number" min="0" step="0.01" className={inputCls}
                  value={form.stock_kg}
                  onChange={(e) => setForm(f => ({ ...f, stock_kg: e.target.value }))} />
              </Field>
              <Field label="Estimated Price (Rs)">
                <input type="number" min="0" step="0.01" className={inputCls}
                  value={form.estimated_price}
                  onChange={(e) => setForm(f => ({ ...f, estimated_price: e.target.value }))}
                  placeholder="0" />
              </Field>

              <Field label="Contact Person">
                <input className={inputCls} value={form.contact_person}
                  onChange={(e) => setForm(f => ({ ...f, contact_person: e.target.value }))}
                  placeholder="Person to contact" />
              </Field>
              <Field label="Contact No.">
                <input className={inputCls} value={form.contact_phone}
                  onChange={(e) => setForm(f => ({ ...f, contact_phone: e.target.value }))}
                  placeholder="98XXXXXXXX" />
              </Field>

              <Field label="Location" span={2}>
                <input className={inputCls} value={form.location}
                  onChange={(e) => setForm(f => ({ ...f, location: e.target.value }))}
                  placeholder="Where this stock is kept / site address" />
              </Field>

              <Field label="Description" span={2}>
                <textarea className={inputCls + " !min-h-[90px] resize-y"} value={form.description}
                  onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Anything worth knowing about this product" />
              </Field>
            </div>
          </form>
        </Modal>
      )}

      {toDelete && (
        <ConfirmDialog
          title="Delete product?"
          message={`Delete "${toDelete.name}" from inventory? This can't be undone.`}
          onCancel={() => setToDelete(null)}
          onConfirm={confirmDelete}
          busy={deleting}
        />
      )}
    </>
  );
}
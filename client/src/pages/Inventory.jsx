/* ==========================================================================
   Inventory.jsx — products with stock levels and low-stock warnings.
   ========================================================================== */
import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import {
  Button, Modal, Field, ConfirmDialog, Badge, PageHeader,
  inputCls, selectCls,
} from "../components/ui";
import DataTable from "../components/DataTable";

const EMPTY_FORM = { name: "", category: "", stock_kg: 0, reorder_level: 0 };

export default function Inventory() {
  const { has } = useAuth();
  const canCreate = has("inventory", "create");
  const canUpdate = has("inventory", "update");
  const canDelete = has("inventory", "delete");

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState(""); // "", "low", "ok"

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
      setRows(items);
    } catch (e) {
      setError(e.message || "Failed to load inventory");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  const isLow = (r) => Number(r.stock_kg) < Number(r.reorder_level);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter === "low" && !isLow(r)) return false;
      if (statusFilter === "ok"  &&  isLow(r)) return false;
      if (!q) return true;
      return (
        r.name?.toLowerCase().includes(q) ||
        r.category?.toLowerCase().includes(q)
      );
    });
  }, [rows, search, statusFilter]);

  const stats = useMemo(() => {
    const totalStock = rows.reduce((s, r) => s + Number(r.stock_kg || 0), 0);
    const lowCount = rows.filter(isLow).length;
    const categories = new Set(rows.map(r => r.category)).size;
    return [
      { label: "Total Products",  value: String(rows.length) },
      { label: "Total Stock",     value: `${totalStock.toLocaleString("en-IN")} kg` },
      { label: "Low Stock Items", value: String(lowCount) },
      { label: "Categories",      value: String(categories) },
    ];
  }, [rows]);

  function openCreate() {
    setEditing(null); setForm(EMPTY_FORM); setFormError(null); setShowForm(true);
  }
  function openEdit(row) {
    setEditing(row);
    setForm({
      name: row.name || "",
      category: row.category || "",
      stock_kg: Number(row.stock_kg || 0),
      reorder_level: Number(row.reorder_level || 0),
    });
    setFormError(null); setShowForm(true);
  }

  async function save(e) {
    e.preventDefault(); setSaving(true); setFormError(null);
    try {
      const payload = {
        name: form.name.trim(),
        category: form.category.trim(),
        stock_kg: Number(form.stock_kg) || 0,
        reorder_level: Number(form.reorder_level) || 0,
      };
      if (!payload.name)     { setFormError("Name is required.");     return; }
      if (!payload.category) { setFormError("Category is required."); return; }
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
    { key: "reorder_level", label: "Reorder Level", numeric: true,
      render: (r) => `${Number(r.reorder_level).toLocaleString("en-IN")} kg` },
    { key: "status", label: "Status",
      render: (r) => isLow(r)
        ? <Badge variant="warning">Low Stock</Badge>
        : <Badge variant="positive">Healthy</Badge> },
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
          placeholder="Product or category" className={inputCls + " !w-64"} />
        <label htmlFor="inv-status" className="text-xs text-ink-faint pl-1">Stock</label>
        <select id="inv-status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className={selectCls + " !w-auto"}>
          <option value="">All</option>
          <option value="low">Low stock</option>
          <option value="ok">Healthy</option>
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
              <Field label="Reorder Level (kg)">
                <input type="number" min="0" step="0.01" className={inputCls}
                  value={form.reorder_level}
                  onChange={(e) => setForm(f => ({ ...f, reorder_level: e.target.value }))} />
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
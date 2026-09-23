/* ==========================================================================
   Suppliers.jsx — the canonical CRUD page.
   Layout: header → stats row → filter bar → paginated table → form modal.
   Every other CRUD module (Customers, Inventory, Purchases, Sales,
   Transportation, OfficeExpenses, Demolition) is a variation of this file.
   ========================================================================== */
import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import {
  Button, Modal, Field, ConfirmDialog, Badge, PageHeader,
  inputCls, selectCls,
} from "../components/ui";
import DataTable from "../components/DataTable";

const EMPTY_FORM = { name: "", contact: "", phone: "", type: "main" };

export default function Suppliers() {
  const { has } = useAuth();
  const canCreate = has("suppliers", "create");
  const canUpdate = has("suppliers", "update");
  const canDelete = has("suppliers", "delete");

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Filters
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");

  // Form modal state
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);   // supplier being edited, or null for new
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);

  // Delete confirm state
  const [toDelete, setToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const { items } = await api.get("/api/suppliers");
      setRows(items);
    } catch (e) {
      setError(e.message || "Failed to load suppliers");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (typeFilter && r.type !== typeFilter) return false;
      if (!q) return true;
      return (
        r.name?.toLowerCase().includes(q) ||
        r.contact?.toLowerCase().includes(q) ||
        r.phone?.toLowerCase().includes(q)
      );
    });
  }, [rows, search, typeFilter]);

  const stats = useMemo(() => [
    { label: "Total Suppliers", value: String(rows.length) },
    { label: "Main Suppliers",  value: String(rows.filter(r => r.type === "main").length) },
    { label: "Small Suppliers", value: String(rows.filter(r => r.type === "small").length) },
    { label: "Showing",         value: `${filtered.length} / ${rows.length}` },
  ], [rows, filtered]);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setShowForm(true);
  }
  function openEdit(row) {
    setEditing(row);
    setForm({
      name: row.name || "",
      contact: row.contact || "",
      phone: row.phone || "",
      type: row.type || "main",
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
        name: form.name.trim(),
        contact: form.contact.trim() || undefined,
        phone: form.phone.trim() || undefined,
        type: form.type,
      };
      if (!payload.name) {
        setFormError("Name is required.");
        return;
      }
      if (editing) {
        await api.patch(`/api/suppliers/${editing.id}`, payload);
      } else {
        await api.post("/api/suppliers", payload);
      }
      setShowForm(false);
      await load();
    } catch (e) {
      setFormError(e.message || "Could not save supplier");
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await api.del(`/api/suppliers/${toDelete.id}`);
      setToDelete(null);
      await load();
    } catch (e) {
      alert(e.message || "Could not delete supplier");
    } finally {
      setDeleting(false);
    }
  }

  const columns = [
    { key: "name",    label: "Name" },
    { key: "contact", label: "Contact", render: (r) => r.contact || "—" },
    { key: "phone",   label: "Phone",   render: (r) => r.phone || "—" },
    {
      key: "type",
      label: "Type",
      render: (r) => (
        <Badge variant={r.type === "main" ? "positive" : "neutral"}>
          {r.type === "main" ? "Main" : "Small"}
        </Badge>
      ),
    },
    {
      key: "actions",
      label: "",
      render: (r) => (
        <div className="flex gap-1.5 justify-end">
          {canUpdate && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); openEdit(r); }}
              className="text-steel text-xs hover:underline"
            >
              Edit
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setToDelete(r); }}
              className="text-negative text-xs hover:underline"
            >
              Delete
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Suppliers"
        description="Everyone we buy from — contacts, phone numbers, and account type"
        actions={
          canCreate ? (
            <Button variant="primary" onClick={openCreate}>+ Add Supplier</Button>
          ) : null
        }
      />

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-3 mb-[18px] max-[980px]:grid-cols-2 max-[520px]:grid-cols-1">
        {stats.map((s, i) => (
          <div key={i} className="bg-surface-sunken border border-line-soft rounded-sm px-3.5 py-[13px]">
            <div className="text-[11.5px] text-ink-faint mb-1.5">{s.label}</div>
            <div className="text-base font-semibold tabular-nums">{s.value}</div>
          </div>
        ))}
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-2 flex-wrap bg-surface border border-line rounded-md p-2.5 mb-6">
        <label htmlFor="supplier-search" className="text-xs text-ink-faint pl-1">Search</label>
        <input
          id="supplier-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Name, contact, or phone"
          className={inputCls + " !w-64"}
        />
        <label htmlFor="supplier-type" className="text-xs text-ink-faint pl-1">Type</label>
        <select
          id="supplier-type"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className={selectCls + " !w-auto"}
        >
          <option value="">All types</option>
          <option value="main">Main</option>
          <option value="small">Small</option>
        </select>
        <span className="ml-auto text-[12.5px] text-ink-soft pr-1">
          Showing <strong className="text-ink font-semibold">{filtered.length}</strong>
        </span>
      </div>

      {/* Table */}
      {error && (
        <div className="mb-4 text-sm text-negative bg-negative-tint border border-negative-tint rounded-md px-3 py-2">
          {error}
        </div>
      )}
      {loading ? (
        <div className="text-ink-faint text-sm py-8 text-center">Loading suppliers…</div>
      ) : (
        <DataTable
          columns={columns}
          rows={filtered}
          emptyMessage={
            rows.length === 0
              ? (canCreate ? 'No suppliers yet — click "+ Add Supplier" to get started.' : "No suppliers yet.")
              : "No suppliers match the current filter."
          }
        />
      )}

      {/* Form modal */}
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
            <div className="grid grid-cols-2 gap-3.5 mb-3.5 max-[560px]:grid-cols-1">
              <Field label="Name" span={2}>
                <input
                  className={inputCls}
                  value={form.name}
                  onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Himal Steel Industries"
                  autoFocus
                  required
                />
              </Field>
              <Field label="Contact Person">
                <input
                  className={inputCls}
                  value={form.contact}
                  onChange={(e) => setForm(f => ({ ...f, contact: e.target.value }))}
                  placeholder="e.g. Deepak Agrawal"
                />
              </Field>
              <Field label="Phone">
                <input
                  className={inputCls}
                  value={form.phone}
                  onChange={(e) => setForm(f => ({ ...f, phone: e.target.value }))}
                  placeholder="98XXXXXXXX"
                />
              </Field>
              <Field label="Type" span={2}>
                <select
                  className={selectCls}
                  value={form.type}
                  onChange={(e) => setForm(f => ({ ...f, type: e.target.value }))}
                >
                  <option value="main">Main</option>
                  <option value="small">Small</option>
                </select>
              </Field>
            </div>
          </form>
        </Modal>
      )}

      {/* Delete confirm */}
      {toDelete && (
        <ConfirmDialog
          title="Delete supplier?"
          message={`Delete "${toDelete.name}"? This can't be undone. Past purchases from this supplier are preserved.`}
          onCancel={() => setToDelete(null)}
          onConfirm={confirmDelete}
          busy={deleting}
        />
      )}
    </>
  );
}
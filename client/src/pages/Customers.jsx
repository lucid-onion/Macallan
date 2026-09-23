/* ==========================================================================
   Customers.jsx — mirror of Suppliers.jsx with customers endpoints.
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

export default function Customers() {
  const { has } = useAuth();
  const canCreate = has("customers", "create");
  const canUpdate = has("customers", "update");
  const canDelete = has("customers", "delete");

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");

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
      const { items } = await api.get("/api/customers");
      setRows(items);
    } catch (e) {
      setError(e.message || "Failed to load customers");
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
    { label: "Total Customers", value: String(rows.length) },
    { label: "Main Customers",  value: String(rows.filter(r => r.type === "main").length) },
    { label: "Small Customers", value: String(rows.filter(r => r.type === "small").length) },
    { label: "Showing",         value: `${filtered.length} / ${rows.length}` },
  ], [rows, filtered]);

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
      if (editing) await api.patch(`/api/customers/${editing.id}`, payload);
      else         await api.post(`/api/customers`, payload);
      setShowForm(false);
      await load();
    } catch (e) {
      setFormError(e.message || "Could not save customer");
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await api.del(`/api/customers/${toDelete.id}`);
      setToDelete(null);
      await load();
    } catch (e) {
      alert(e.message || "Could not delete customer");
    } finally {
      setDeleting(false);
    }
  }

  const columns = [
    { key: "name",    label: "Name" },
    { key: "contact", label: "Contact", render: (r) => r.contact || "—" },
    { key: "phone",   label: "Phone",   render: (r) => r.phone || "—" },
    {
      key: "type", label: "Type",
      render: (r) => (
        <Badge variant={r.type === "main" ? "positive" : "neutral"}>
          {r.type === "main" ? "Main" : "Small"}
        </Badge>
      ),
    },
    {
      key: "actions", label: "",
      render: (r) => (
        <div className="flex gap-1.5 justify-end">
          {canUpdate && (
            <button type="button"
              onClick={(e) => { e.stopPropagation(); openEdit(r); }}
              className="text-steel text-xs hover:underline">Edit</button>
          )}
          {canDelete && (
            <button type="button"
              onClick={(e) => { e.stopPropagation(); setToDelete(r); }}
              className="text-negative text-xs hover:underline">Delete</button>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Customers"
        description="Everyone we sell to — contacts, phone numbers, and account type"
        actions={canCreate ? <Button variant="primary" onClick={openCreate}>+ Add Customer</Button> : null}
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
        <label htmlFor="customer-search" className="text-xs text-ink-faint pl-1">Search</label>
        <input id="customer-search" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Name, contact, or phone" className={inputCls + " !w-64"} />
        <label htmlFor="customer-type" className="text-xs text-ink-faint pl-1">Type</label>
        <select id="customer-type" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}
          className={selectCls + " !w-auto"}>
          <option value="">All types</option>
          <option value="main">Main</option>
          <option value="small">Small</option>
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
        <div className="text-ink-faint text-sm py-8 text-center">Loading customers…</div>
      ) : (
        <DataTable
          columns={columns}
          rows={filtered}
          emptyMessage={
            rows.length === 0
              ? (canCreate ? 'No customers yet — click "+ Add Customer" to get started.' : "No customers yet.")
              : "No customers match the current filter."
          }
        />
      )}

      {showForm && (
        <Modal
          title={editing ? "Edit Customer" : "New Customer"}
          onClose={() => setShowForm(false)}
          footer={
            <>
              <Button onClick={() => setShowForm(false)} disabled={saving}>Cancel</Button>
              <Button variant="primary" type="submit" form="customer-form" disabled={saving}>
                {saving ? "Saving…" : editing ? "Save Changes" : "Add Customer"}
              </Button>
            </>
          }
        >
          <form id="customer-form" onSubmit={save}>
            {formError && (
              <div className="mb-4 text-sm text-negative bg-negative-tint border border-negative-tint rounded-md px-3 py-2">
                {formError}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3.5 mb-3.5 max-[560px]:grid-cols-1">
              <Field label="Name" span={2}>
                <input className={inputCls} value={form.name} autoFocus required
                  onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Ambey Steels" />
              </Field>
              <Field label="Contact Person">
                <input className={inputCls} value={form.contact}
                  onChange={(e) => setForm(f => ({ ...f, contact: e.target.value }))}
                  placeholder="e.g. Rajendra Shrestha" />
              </Field>
              <Field label="Phone">
                <input className={inputCls} value={form.phone}
                  onChange={(e) => setForm(f => ({ ...f, phone: e.target.value }))}
                  placeholder="98XXXXXXXX" />
              </Field>
              <Field label="Type" span={2}>
                <select className={selectCls} value={form.type}
                  onChange={(e) => setForm(f => ({ ...f, type: e.target.value }))}>
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
          title="Delete customer?"
          message={`Delete "${toDelete.name}"? This can't be undone. Past sales to this customer are preserved.`}
          onCancel={() => setToDelete(null)}
          onConfirm={confirmDelete}
          busy={deleting}
        />
      )}
    </>
  );
}
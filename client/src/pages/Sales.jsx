/* ==========================================================================
   Sales.jsx — sales register with auto-calculated weights, totals and dust value.
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
  customer_id: "",
  invoice: "",
  product: "",
  date_bs_year: 2082,
  date_bs_month: 1,
  date_bs_day: 1,
  date_ad: today.toISOString().slice(0, 10),
  gross_qty: "",
  dust_qty: "0",
  rate: "",
  status: "Delivered",
  company: "ASN Demolition Pvt.Ltd",
};

function num(v) { const n = Number(v); return isFinite(n) ? n : 0; }

export default function Sales() {
  const { has } = useAuth();
  const canCreate = has("sales", "create");
  const canUpdate = has("sales", "update");
  const canDelete = has("sales", "delete");

  const [rows, setRows] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [customerFilter, setCustomerFilter] = useState("");

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
      const [s, c] = await Promise.all([
        api.get("/api/sales"),
        api.get("/api/customers"),
      ]);
      setRows(s.items);
      setCustomers(c.items);
    } catch (e) {
      setError(e.message || "Failed to load sales");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  const computed = useMemo(() => {
    const gross = num(form.gross_qty);
    const dust  = num(form.dust_qty);
    const net   = Math.max(0, gross - dust);
    const rate  = num(form.rate);
    const total = net * rate;
    const dustValue = dust * rate;
    return { gross, dust, net, rate, total, dustValue };
  }, [form.gross_qty, form.dust_qty, form.rate]);

  const customerNameById = useMemo(() => {
    const map = new Map();
    customers.forEach(c => map.set(c.id, c.name));
    return map;
  }, [customers]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter && r.status !== statusFilter) return false;
      if (customerFilter && String(r.customer_id) !== customerFilter) return false;
      if (!q) return true;
      return (
        r.invoice?.toLowerCase().includes(q) ||
        r.product?.toLowerCase().includes(q) ||
        customerNameById.get(r.customer_id)?.toLowerCase().includes(q)
      );
    });
  }, [rows, search, statusFilter, customerFilter, customerNameById]);

  const stats = useMemo(() => {
    const total = rows.reduce((s, r) => s + num(r.total), 0);
    const qty = rows.reduce((s, r) => s + num(r.net_qty), 0);
    const avg = rows.length ? total / rows.length : 0;
    const delivered = rows.filter(r => r.status === "Delivered").length;
    return [
      { label: "Total Sales",     value: `Rs. ${total.toLocaleString("en-IN")}` },
      { label: "Steel Sold (Net)", value: `${qty.toLocaleString("en-IN")} kg` },
      { label: "Average Sale",    value: `Rs. ${Math.round(avg).toLocaleString("en-IN")}` },
      { label: "Delivered",       value: `${delivered} / ${rows.length}` },
    ];
  }, [rows]);

  function openCreate() {
    setEditing(null);
    setForm({
      ...EMPTY_FORM,
      customer_id: customers[0]?.id || "",
      invoice: `INV-${String(rows.length + 1).padStart(4, "0")}`,
    });
    setFormError(null);
    setShowForm(true);
  }
  function openEdit(row) {
    setEditing(row);
    setForm({
      customer_id: row.customer_id || "",
      invoice: row.invoice || "",
      product: row.product || "",
      date_bs_year: row.date_bs_year || 2082,
      date_bs_month: row.date_bs_month || 1,
      date_bs_day: row.date_bs_day || 1,
      date_ad: row.date_ad ? String(row.date_ad).slice(0, 10) : today.toISOString().slice(0, 10),
      gross_qty: row.gross_qty ?? "",
      dust_qty: row.dust_qty ?? "0",
      rate: row.rate ?? "",
      status: row.status || "Delivered",
      company: row.company || "ASN Demolition Pvt.Ltd",
    });
    setFormError(null);
    setShowForm(true);
  }

  async function save(e) {
    e.preventDefault(); setSaving(true); setFormError(null);
    try {
      const payload = {
        invoice: form.invoice.trim(),
        customer_id: Number(form.customer_id),
        product: form.product.trim(),
        date_bs_year: Number(form.date_bs_year),
        date_bs_month: Number(form.date_bs_month),
        date_bs_day: Number(form.date_bs_day),
        date_ad: form.date_ad,
        gross_qty: computed.gross,
        dust_qty: computed.dust,
        net_qty: computed.net,
        rate: computed.rate,
        total: computed.total,
        status: form.status,
        company: form.company.trim() || undefined,
      };
      if (!payload.invoice)     { setFormError("Invoice is required."); return; }
      if (!payload.customer_id) { setFormError("Select a customer."); return; }
      if (!payload.product)     { setFormError("Product is required."); return; }
      if (payload.gross_qty <= 0) { setFormError("Gross quantity must be positive."); return; }
      if (payload.rate <= 0)    { setFormError("Rate must be positive."); return; }

      if (editing) await api.patch(`/api/sales/${editing.id}`, payload);
      else         await api.post(`/api/sales`, payload);
      setShowForm(false);
      await load();
    } catch (e) {
      setFormError(e.message || "Could not save sale");
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await api.del(`/api/sales/${toDelete.id}`);
      setToDelete(null);
      await load();
    } catch (e) {
      alert(e.message || "Could not delete sale");
    } finally {
      setDeleting(false);
    }
  }

  const columns = [
    { key: "date_bs", label: "Date (BS)",
      render: (r) => `${r.date_bs_year}/${String(r.date_bs_month).padStart(2, "0")}/${String(r.date_bs_day).padStart(2, "0")}` },
    { key: "date_ad", label: "Date (EN)",
      render: (r) => r.date_ad ? String(r.date_ad).slice(0, 10) : "—" },
    { key: "invoice", label: "Invoice" },
    { key: "customer", label: "Customer",
      render: (r) => customerNameById.get(r.customer_id) || "—" },
    { key: "product", label: "Product" },
    { key: "gross_qty", label: "Gross", numeric: true,
      render: (r) => `${num(r.gross_qty).toLocaleString("en-IN")} kg` },
    { key: "dust_qty", label: "Dust", numeric: true,
      render: (r) => `${num(r.dust_qty).toLocaleString("en-IN")} kg` },
    { key: "net_qty", label: "Net", numeric: true,
      render: (r) => `${num(r.net_qty).toLocaleString("en-IN")} kg` },
    { key: "rate", label: "Rate", numeric: true,
      render: (r) => `Rs. ${num(r.rate).toLocaleString("en-IN")}/kg` },
    { key: "total", label: "Total", numeric: true,
      render: (r) => `Rs. ${num(r.total).toLocaleString("en-IN")}` },
    { key: "status", label: "Status",
      render: (r) => (
        <Badge variant={r.status === "Delivered" ? "positive" : "warning"}>{r.status}</Badge>
      ) },
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
        title="Sales"
        description="Every sale — product, weights, rate and customer"
        actions={canCreate ? <Button variant="primary" onClick={openCreate}>+ New Sale</Button> : null}
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
        <label htmlFor="sale-search" className="text-xs text-ink-faint pl-1">Search</label>
        <input id="sale-search" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Invoice, product, customer" className={inputCls + " !w-64"} />
        <label htmlFor="sale-customer" className="text-xs text-ink-faint pl-1">Customer</label>
        <select id="sale-customer" value={customerFilter} onChange={(e) => setCustomerFilter(e.target.value)}
          className={selectCls + " !w-auto"}>
          <option value="">All customers</option>
          {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <label htmlFor="sale-status" className="text-xs text-ink-faint pl-1">Status</label>
        <select id="sale-status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className={selectCls + " !w-auto"}>
          <option value="">All</option>
          <option value="Delivered">Delivered</option>
          <option value="Pending">Pending</option>
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
        <div className="text-ink-faint text-sm py-8 text-center">Loading sales…</div>
      ) : (
        <DataTable
          columns={columns}
          rows={filtered}
          emptyMessage={
            rows.length === 0
              ? (canCreate ? 'No sales yet — click "+ New Sale" to get started.' : "No sales yet.")
              : "No sales match the current filter."
          }
        />
      )}

      {showForm && (
        <Modal
          title={editing ? `Edit Sale — ${editing.invoice}` : "New Sale"}
          onClose={() => setShowForm(false)}
          wide
          footer={
            <>
              <Button onClick={() => setShowForm(false)} disabled={saving}>Cancel</Button>
              <Button variant="primary" type="submit" form="sale-form" disabled={saving}>
                {saving ? "Saving…" : editing ? "Save Changes" : "Save Sale"}
              </Button>
            </>
          }
        >
          <form id="sale-form" onSubmit={save}>
            {formError && (
              <div className="mb-4 text-sm text-negative bg-negative-tint border border-negative-tint rounded-md px-3 py-2">
                {formError}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3.5 mb-5 max-[560px]:grid-cols-1">
              <Field label="Customer">
                <select className={selectCls} value={form.customer_id} required
                  onChange={(e) => setForm(f => ({ ...f, customer_id: e.target.value }))}>
                  <option value="">— select —</option>
                  {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              <Field label="Invoice #">
                <input className={inputCls} value={form.invoice} required
                  onChange={(e) => setForm(f => ({ ...f, invoice: e.target.value }))} />
              </Field>
              <Field label="Product" span={2}>
                <input className={inputCls} value={form.product} required
                  placeholder="e.g. TMT Rod 12mm"
                  onChange={(e) => setForm(f => ({ ...f, product: e.target.value }))} />
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

              <Field label="Gross Qty (kg)">
                <input type="number" min="0" step="0.001" className={inputCls} value={form.gross_qty} required
                  onChange={(e) => setForm(f => ({ ...f, gross_qty: e.target.value }))} />
              </Field>
              <Field label="Dust (kg)">
                <input type="number" min="0" step="0.001" className={inputCls} value={form.dust_qty}
                  onChange={(e) => setForm(f => ({ ...f, dust_qty: e.target.value }))} />
              </Field>

              <Field label="Net Qty (computed)">
                <div className={inputCls + " !bg-steel-tint !text-steel-dark font-semibold"}>
                  {computed.net.toLocaleString("en-IN")} kg
                </div>
              </Field>
              <Field label="Dust Value (dust × rate)">
                <div className={inputCls + " !bg-warning-tint !text-warning font-semibold"}>
                  Rs. {computed.dustValue.toLocaleString("en-IN")}
                </div>
              </Field>

              <Field label="Rate (Rs/kg)">
                <input type="number" min="0" step="0.01" className={inputCls} value={form.rate} required
                  onChange={(e) => setForm(f => ({ ...f, rate: e.target.value }))} />
              </Field>
              <Field label="Total (net × rate)">
                <div className={inputCls + " !bg-steel-tint !text-steel-dark font-semibold !text-[15px]"}>
                  Rs. {computed.total.toLocaleString("en-IN")}
                </div>
              </Field>

              <Field label="Status">
                <select className={selectCls} value={form.status}
                  onChange={(e) => setForm(f => ({ ...f, status: e.target.value }))}>
                  <option value="Delivered">Delivered</option>
                  <option value="Pending">Pending</option>
                </select>
              </Field>
              <Field label="Company">
                <input className={inputCls} value={form.company}
                  onChange={(e) => setForm(f => ({ ...f, company: e.target.value }))} />
              </Field>
            </div>
          </form>
        </Modal>
      )}

      {toDelete && (
        <ConfirmDialog
          title="Delete sale?"
          message={`Delete sale ${toDelete.invoice}? This can't be undone.`}
          onCancel={() => setToDelete(null)}
          onConfirm={confirmDelete}
          busy={deleting}
        />
      )}
    </>
  );
}
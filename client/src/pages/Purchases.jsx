/* ==========================================================================
   Purchases.jsx — purchase register with auto-calculated weights and totals.
   Form fields: supplier, invoice, material, BS date, gross/dust/net weight,
   rate, computed total, transport costs, truck + driver details, status.
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
  supplier_id: "",
  invoice: "",
  material: "",
  date_bs_year: 2082,
  date_bs_month: 1,
  date_bs_day: 1,
  date_ad: today.toISOString().slice(0, 10),
  gross_qty: "",
  dust_qty: "0",
  rate: "",
  transport_fee: "0",
  labor_charge: "0",
  road_expense: "0",
  tax_gbse: "0",
  truck_no: "",
  truck_driver: "",
  truck_driver_phone: "",
  from_location: "",
  to_location: "",
  status: "Delivered",
  company: "ASN Demolition Pvt.Ltd",
};

function num(v) { const n = Number(v); return isFinite(n) ? n : 0; }

export default function Purchases() {
  const { has } = useAuth();
  const canCreate = has("purchases", "create");
  const canUpdate = has("purchases", "update");
  const canDelete = has("purchases", "delete");

  const [rows, setRows] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("");

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
      const [p, s] = await Promise.all([
        api.get("/api/purchases"),
        api.get("/api/suppliers"),
      ]);
      setRows(p.items);
      setSuppliers(s.items);
    } catch (e) {
      setError(e.message || "Failed to load purchases");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  // ---- Live computed values ---------------------------------------------
  const computed = useMemo(() => {
    const gross = num(form.gross_qty);
    const dust  = num(form.dust_qty);
    const net   = Math.max(0, gross - dust);
    const rate  = num(form.rate);
    const total = net * rate;
    const transportTotal = num(form.transport_fee) + num(form.labor_charge) + num(form.road_expense) + num(form.tax_gbse);
    return { gross, dust, net, rate, total, transportTotal };
  }, [form.gross_qty, form.dust_qty, form.rate, form.transport_fee, form.labor_charge, form.road_expense, form.tax_gbse]);

  // ---- Filtering --------------------------------------------------------
  const supplierNameById = useMemo(() => {
    const map = new Map();
    suppliers.forEach(s => map.set(s.id, s.name));
    return map;
  }, [suppliers]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter && r.status !== statusFilter) return false;
      if (supplierFilter && String(r.supplier_id) !== supplierFilter) return false;
      if (!q) return true;
      return (
        r.invoice?.toLowerCase().includes(q) ||
        r.material?.toLowerCase().includes(q) ||
        supplierNameById.get(r.supplier_id)?.toLowerCase().includes(q)
      );
    });
  }, [rows, search, statusFilter, supplierFilter, supplierNameById]);

  const stats = useMemo(() => {
    const total = rows.reduce((s, r) => s + num(r.total), 0);
    const qty = rows.reduce((s, r) => s + num(r.net_qty), 0);
    const transportTotal = rows.reduce((s, r) =>
      s + num(r.transport_fee) + num(r.labor_charge) + num(r.road_expense) + num(r.tax_gbse), 0);
    const delivered = rows.filter(r => r.status === "Delivered").length;
    return [
      { label: "Total Purchases", value: `Rs. ${total.toLocaleString("en-IN")}` },
      { label: "Steel Purchased", value: `${qty.toLocaleString("en-IN")} kg` },
      { label: "Transport Cost",  value: `Rs. ${transportTotal.toLocaleString("en-IN")}` },
      { label: "Delivered",       value: `${delivered} / ${rows.length}` },
    ];
  }, [rows]);

  // ---- Form open/save ---------------------------------------------------
  function openCreate() {
    setEditing(null);
    setForm({
      ...EMPTY_FORM,
      supplier_id: suppliers[0]?.id || "",
      invoice: `PUR-${String(rows.length + 1).padStart(4, "0")}`,
    });
    setFormError(null);
    setShowForm(true);
  }
  function openEdit(row) {
    setEditing(row);
    setForm({
      supplier_id: row.supplier_id || "",
      invoice: row.invoice || "",
      material: row.material || "",
      date_bs_year: row.date_bs_year || 2082,
      date_bs_month: row.date_bs_month || 1,
      date_bs_day: row.date_bs_day || 1,
      date_ad: row.date_ad ? String(row.date_ad).slice(0, 10) : today.toISOString().slice(0, 10),
      gross_qty: row.gross_qty ?? "",
      dust_qty: row.dust_qty ?? "0",
      rate: row.rate ?? "",
      transport_fee: row.transport_fee ?? "0",
      labor_charge: row.labor_charge ?? "0",
      road_expense: row.road_expense ?? "0",
      tax_gbse: row.tax_gbse ?? "0",
      truck_no: row.truck_no || "",
      truck_driver: row.truck_driver || "",
      truck_driver_phone: row.truck_driver_phone || "",
      from_location: row.from_location || "",
      to_location: row.to_location || "",
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
        supplier_id: Number(form.supplier_id),
        material: form.material.trim(),
        date_bs_year: Number(form.date_bs_year),
        date_bs_month: Number(form.date_bs_month),
        date_bs_day: Number(form.date_bs_day),
        date_ad: form.date_ad,
        gross_qty: computed.gross,
        dust_qty: computed.dust,
        net_qty: computed.net,
        rate: computed.rate,
        total: computed.total,
        transport_fee: num(form.transport_fee),
        labor_charge: num(form.labor_charge),
        road_expense: num(form.road_expense),
        tax_gbse: num(form.tax_gbse),
        truck_no: form.truck_no.trim() || undefined,
        truck_driver: form.truck_driver.trim() || undefined,
        truck_driver_phone: form.truck_driver_phone.trim() || undefined,
        from_location: form.from_location.trim() || undefined,
        to_location: form.to_location.trim() || undefined,
        status: form.status,
        company: form.company.trim() || undefined,
      };
      if (!payload.invoice)     { setFormError("Invoice is required."); return; }
      if (!payload.supplier_id) { setFormError("Select a supplier."); return; }
      if (!payload.material)    { setFormError("Material is required."); return; }
      if (payload.gross_qty <= 0) { setFormError("Gross quantity must be positive."); return; }
      if (payload.rate <= 0)    { setFormError("Rate must be positive."); return; }

      if (editing) await api.patch(`/api/purchases/${editing.id}`, payload);
      else         await api.post(`/api/purchases`, payload);
      setShowForm(false);
      await load();
    } catch (e) {
      setFormError(e.message || "Could not save purchase");
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await api.del(`/api/purchases/${toDelete.id}`);
      setToDelete(null);
      await load();
    } catch (e) {
      alert(e.message || "Could not delete purchase");
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
    { key: "supplier", label: "Supplier",
      render: (r) => supplierNameById.get(r.supplier_id) || "—" },
    { key: "material", label: "Material" },
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
        title="Purchases"
        description="Every material purchase — weights, rates, transport and supplier"
        actions={canCreate ? <Button variant="primary" onClick={openCreate}>+ New Purchase</Button> : null}
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
        <label htmlFor="pur-search" className="text-xs text-ink-faint pl-1">Search</label>
        <input id="pur-search" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Invoice, material, supplier" className={inputCls + " !w-64"} />
        <label htmlFor="pur-supplier" className="text-xs text-ink-faint pl-1">Supplier</label>
        <select id="pur-supplier" value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)}
          className={selectCls + " !w-auto"}>
          <option value="">All suppliers</option>
          {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <label htmlFor="pur-status" className="text-xs text-ink-faint pl-1">Status</label>
        <select id="pur-status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
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
        <div className="text-ink-faint text-sm py-8 text-center">Loading purchases…</div>
      ) : (
        <DataTable
          columns={columns}
          rows={filtered}
          emptyMessage={
            rows.length === 0
              ? (canCreate ? 'No purchases yet — click "+ New Purchase" to get started.' : "No purchases yet.")
              : "No purchases match the current filter."
          }
        />
      )}

      {showForm && (
        <Modal
          title={editing ? `Edit Purchase — ${editing.invoice}` : "New Purchase"}
          onClose={() => setShowForm(false)}
          wide
          footer={
            <>
              <Button onClick={() => setShowForm(false)} disabled={saving}>Cancel</Button>
              <Button variant="primary" type="submit" form="purchase-form" disabled={saving}>
                {saving ? "Saving…" : editing ? "Save Changes" : "Save Purchase"}
              </Button>
            </>
          }
        >
          <form id="purchase-form" onSubmit={save}>
            {formError && (
              <div className="mb-4 text-sm text-negative bg-negative-tint border border-negative-tint rounded-md px-3 py-2">
                {formError}
              </div>
            )}

            {/* Section: Material */}
            <h4 className="text-[13.5px] font-semibold mb-3">Material</h4>
            <div className="grid grid-cols-2 gap-3.5 mb-5 max-[560px]:grid-cols-1">
              <Field label="Supplier">
                <select className={selectCls} value={form.supplier_id} required
                  onChange={(e) => setForm(f => ({ ...f, supplier_id: e.target.value }))}>
                  <option value="">— select —</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
              <Field label="Invoice #">
                <input className={inputCls} value={form.invoice} required
                  onChange={(e) => setForm(f => ({ ...f, invoice: e.target.value }))} />
              </Field>
              <Field label="Material" span={2}>
                <input className={inputCls} value={form.material} required
                  placeholder="e.g. TMT Rod 12mm"
                  onChange={(e) => setForm(f => ({ ...f, material: e.target.value }))} />
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
              <Field label="Rate (Rs/kg)">
                <input type="number" min="0" step="0.01" className={inputCls} value={form.rate} required
                  onChange={(e) => setForm(f => ({ ...f, rate: e.target.value }))} />
              </Field>

              <Field label="Total (computed)" span={2}>
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

            {/* Section: Transport */}
            <h4 className="text-[13.5px] font-semibold mb-3 pt-4 border-t border-dashed border-line">
              Truck &amp; Transport Detail
            </h4>
            <div className="grid grid-cols-2 gap-3.5 mb-5 max-[560px]:grid-cols-1">
              <Field label="Truck No.">
                <input className={inputCls} value={form.truck_no}
                  onChange={(e) => setForm(f => ({ ...f, truck_no: e.target.value }))}
                  placeholder="BA 1 KHA 1234" />
              </Field>
              <Field label="Driver Name">
                <input className={inputCls} value={form.truck_driver}
                  onChange={(e) => setForm(f => ({ ...f, truck_driver: e.target.value }))} />
              </Field>
              <Field label="Driver Phone">
                <input className={inputCls} value={form.truck_driver_phone}
                  onChange={(e) => setForm(f => ({ ...f, truck_driver_phone: e.target.value }))} />
              </Field>
              <Field label="Loader">
                <input className={inputCls} value={form.from_location}
                  onChange={(e) => setForm(f => ({ ...f, from_location: e.target.value }))}
                  placeholder="From address" />
              </Field>
              <Field label="To">
                <input className={inputCls} value={form.to_location}
                  onChange={(e) => setForm(f => ({ ...f, to_location: e.target.value }))}
                  placeholder="Destination" />
              </Field>

              <Field label="Transport Fee (Rs)">
                <input type="number" min="0" step="0.01" className={inputCls} value={form.transport_fee}
                  onChange={(e) => setForm(f => ({ ...f, transport_fee: e.target.value }))} />
              </Field>
              <Field label="Labor Charge (Rs)">
                <input type="number" min="0" step="0.01" className={inputCls} value={form.labor_charge}
                  onChange={(e) => setForm(f => ({ ...f, labor_charge: e.target.value }))} />
              </Field>
              <Field label="Road Expense (Rs)">
                <input type="number" min="0" step="0.01" className={inputCls} value={form.road_expense}
                  onChange={(e) => setForm(f => ({ ...f, road_expense: e.target.value }))} />
              </Field>
              <Field label="Tax G.B.S.E (Rs)">
                <input type="number" min="0" step="0.01" className={inputCls} value={form.tax_gbse}
                  onChange={(e) => setForm(f => ({ ...f, tax_gbse: e.target.value }))} />
              </Field>
              <Field label="Transport Total (computed)">
                <div className={inputCls + " !bg-steel-tint !text-steel-dark font-semibold"}>
                  Rs. {computed.transportTotal.toLocaleString("en-IN")}
                </div>
              </Field>
            </div>
          </form>
        </Modal>
      )}

      {toDelete && (
        <ConfirmDialog
          title="Delete purchase?"
          message={`Delete purchase ${toDelete.invoice}? This can't be undone.`}
          onCancel={() => setToDelete(null)}
          onConfirm={confirmDelete}
          busy={deleting}
        />
      )}
    </>
  );
}
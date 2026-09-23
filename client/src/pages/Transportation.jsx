/* ==========================================================================
   Transportation.jsx — delivery log.
   Each delivery can be linked to a sale, a purchase, or standalone. If
   linked, the party name and load auto-fill from the source record.
   Transport cost is the sum of fee + labor_charge + road_expense + tax_gbse.
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
  link_type: "",         // "", "sale", "purchase"
  sale_id: "",
  purchase_id: "",
  customer_id: "",
  vehicle: "",
  driver: "",
  driver_phone: "",
  loader: "",
  from_location: "",
  to_location: "",
  load_kg: "",
  fee: "0",
  labor_charge: "0",
  road_expense: "0",
  tax_gbse: "0",
  date_bs_year: 2082,
  date_bs_month: 1,
  date_bs_day: 1,
  date_ad: today.toISOString().slice(0, 10),
  status: "Delivered",
};

function num(v) { const n = Number(v); return isFinite(n) ? n : 0; }

export default function Transportation() {
  const { has } = useAuth();
  const canCreate = has("transportation", "create");
  const canUpdate = has("transportation", "update");
  const canDelete = has("transportation", "delete");

  const [rows, setRows] = useState([]);
  const [sales, setSales] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [linkFilter, setLinkFilter] = useState(""); // "", "sale", "purchase", "standalone"

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
      const [t, s, p, c] = await Promise.all([
        api.get("/api/transportation"),
        api.get("/api/sales"),
        api.get("/api/purchases"),
        api.get("/api/customers"),
      ]);
      setRows(t.items);
      setSales(s.items);
      setPurchases(p.items);
      setCustomers(c.items);
    } catch (e) {
      setError(e.message || "Failed to load deliveries");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  // ---- Lookup maps ------------------------------------------------------
  const saleById = useMemo(() => new Map(sales.map(s => [s.id, s])), [sales]);
  const purchaseById = useMemo(() => new Map(purchases.map(p => [p.id, p])), [purchases]);
  const customerById = useMemo(() => new Map(customers.map(c => [c.id, c])), [customers]);

  const partyLabelFor = (row) => {
    if (row.sale_id) {
      const sale = saleById.get(row.sale_id);
      return sale ? `Sale ${sale.invoice}` : `Sale #${row.sale_id}`;
    }
    if (row.purchase_id) {
      const pur = purchaseById.get(row.purchase_id);
      return pur ? `Purchase ${pur.invoice}` : `Purchase #${row.purchase_id}`;
    }
    if (row.customer_id) {
      const cust = customerById.get(row.customer_id);
      return cust ? cust.name : `Customer #${row.customer_id}`;
    }
    return "Standalone";
  };

  // ---- Live computed totals --------------------------------------------
  const computed = useMemo(() => {
    const totalCost =
      num(form.fee) + num(form.labor_charge) + num(form.road_expense) + num(form.tax_gbse);
    return { totalCost };
  }, [form.fee, form.labor_charge, form.road_expense, form.tax_gbse]);

  // When a sale is picked, autofill party/load/from/to if the form is blank.
  const selectedSale = form.link_type === "sale" && form.sale_id ? saleById.get(Number(form.sale_id)) : null;
  const selectedPurchase = form.link_type === "purchase" && form.purchase_id ? purchaseById.get(Number(form.purchase_id)) : null;

  // ---- Filtering --------------------------------------------------------
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter && r.status !== statusFilter) return false;
      if (linkFilter === "sale" && !r.sale_id) return false;
      if (linkFilter === "purchase" && !r.purchase_id) return false;
      if (linkFilter === "standalone" && (r.sale_id || r.purchase_id)) return false;
      if (!q) return true;
      return (
        r.vehicle?.toLowerCase().includes(q) ||
        r.driver?.toLowerCase().includes(q) ||
        r.loader?.toLowerCase().includes(q) ||
        r.from_location?.toLowerCase().includes(q) ||
        r.to_location?.toLowerCase().includes(q)
      );
    });
  }, [rows, search, statusFilter, linkFilter]);

  const stats = useMemo(() => {
    const totalCost = rows.reduce((s, r) =>
      s + num(r.fee) + num(r.labor_charge) + num(r.road_expense) + num(r.tax_gbse), 0);
    const totalLoad = rows.reduce((s, r) => s + num(r.load_kg), 0);
    const avg = rows.length ? totalCost / rows.length : 0;
    const delivered = rows.filter(r => r.status === "Delivered").length;
    return [
      { label: "Total Deliveries", value: String(rows.length) },
      { label: "Transport Cost",   value: `Rs. ${totalCost.toLocaleString("en-IN")}` },
      { label: "Total Load",       value: `${totalLoad.toLocaleString("en-IN")} kg` },
      { label: "Avg Fee / Delivery", value: `Rs. ${Math.round(avg).toLocaleString("en-IN")}` },
    ];
  }, [rows]);

  // ---- Form -------------------------------------------------------------
  function openCreate() {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setFormError(null);
    setShowForm(true);
  }
  function openEdit(row) {
    setEditing(row);
    setForm({
      link_type: row.sale_id ? "sale" : row.purchase_id ? "purchase" : "",
      sale_id: row.sale_id || "",
      purchase_id: row.purchase_id || "",
      customer_id: row.customer_id || "",
      vehicle: row.vehicle || "",
      driver: row.driver || "",
      driver_phone: row.driver_phone || "",
      loader: row.loader || "",
      from_location: row.from_location || "",
      to_location: row.to_location || "",
      load_kg: row.load_kg ?? "",
      fee: row.fee ?? "0",
      labor_charge: row.labor_charge ?? "0",
      road_expense: row.road_expense ?? "0",
      tax_gbse: row.tax_gbse ?? "0",
      date_bs_year: row.date_bs_year || 2082,
      date_bs_month: row.date_bs_month || 1,
      date_bs_day: row.date_bs_day || 1,
      date_ad: row.date_ad ? String(row.date_ad).slice(0, 10) : today.toISOString().slice(0, 10),
      status: row.status || "Delivered",
    });
    setFormError(null);
    setShowForm(true);
  }

  async function save(e) {
    e.preventDefault(); setSaving(true); setFormError(null);
    try {
      const payload = {
        sale_id: form.link_type === "sale" ? Number(form.sale_id) || null : null,
        purchase_id: form.link_type === "purchase" ? Number(form.purchase_id) || null : null,
        customer_id: form.customer_id ? Number(form.customer_id) : null,
        vehicle: form.vehicle.trim() || undefined,
        driver: form.driver.trim() || undefined,
        driver_phone: form.driver_phone.trim() || undefined,
        loader: form.loader.trim() || undefined,
        from_location: form.from_location.trim() || undefined,
        to_location: form.to_location.trim() || undefined,
        load_kg: num(form.load_kg),
        fee: num(form.fee),
        labor_charge: num(form.labor_charge),
        road_expense: num(form.road_expense),
        tax_gbse: num(form.tax_gbse),
        date_bs_year: Number(form.date_bs_year),
        date_bs_month: Number(form.date_bs_month),
        date_bs_day: Number(form.date_bs_day),
        date_ad: form.date_ad,
        status: form.status,
      };
      if (form.link_type === "sale" && !payload.sale_id) { setFormError("Pick a sale or clear the link."); return; }
      if (form.link_type === "purchase" && !payload.purchase_id) { setFormError("Pick a purchase or clear the link."); return; }

      if (editing) await api.patch(`/api/transportation/${editing.id}`, payload);
      else         await api.post(`/api/transportation`, payload);
      setShowForm(false);
      await load();
    } catch (e) {
      setFormError(e.message || "Could not save delivery");
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await api.del(`/api/transportation/${toDelete.id}`);
      setToDelete(null);
      await load();
    } catch (e) {
      alert(e.message || "Could not delete delivery");
    } finally {
      setDeleting(false);
    }
  }

  const columns = [
    { key: "date_bs", label: "Date (BS)",
      render: (r) => `${r.date_bs_year}/${String(r.date_bs_month).padStart(2, "0")}/${String(r.date_bs_day).padStart(2, "0")}` },
    { key: "party", label: "Linked to", render: (r) => partyLabelFor(r) },
    { key: "vehicle", label: "Vehicle", render: (r) => r.vehicle || "—" },
    { key: "driver", label: "Driver", render: (r) => r.driver || "—" },
    { key: "driver_phone", label: "Driver Phone", render: (r) => r.driver_phone || "—" },
    { key: "loader", label: "Loader", render: (r) => r.loader || "—" },
    { key: "route", label: "Route",
      render: (r) => `${r.from_location || "—"} → ${r.to_location || "—"}` },
    { key: "load_kg", label: "Load", numeric: true,
      render: (r) => r.load_kg != null ? `${num(r.load_kg).toLocaleString("en-IN")} kg` : "—" },
    { key: "cost", label: "Cost", numeric: true,
      render: (r) => `Rs. ${(num(r.fee) + num(r.labor_charge) + num(r.road_expense) + num(r.tax_gbse)).toLocaleString("en-IN")}` },
    { key: "status", label: "Status",
      render: (r) => (
        <Badge variant={r.status === "Delivered" ? "positive" : "neutral"}>{r.status}</Badge>
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
        title="Transportation"
        description="Every delivery — vehicle, driver, route, load and cost"
        actions={canCreate ? <Button variant="primary" onClick={openCreate}>+ New Delivery</Button> : null}
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
        <label htmlFor="tr-search" className="text-xs text-ink-faint pl-1">Search</label>
        <input id="tr-search" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Vehicle, driver, route" className={inputCls + " !w-64"} />
        <label htmlFor="tr-link" className="text-xs text-ink-faint pl-1">Linked</label>
        <select id="tr-link" value={linkFilter} onChange={(e) => setLinkFilter(e.target.value)}
          className={selectCls + " !w-auto"}>
          <option value="">All</option>
          <option value="sale">Sale</option>
          <option value="purchase">Purchase</option>
          <option value="standalone">Standalone</option>
        </select>
        <label htmlFor="tr-status" className="text-xs text-ink-faint pl-1">Status</label>
        <select id="tr-status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className={selectCls + " !w-auto"}>
          <option value="">All</option>
          <option value="Delivered">Delivered</option>
          <option value="In Transit">In Transit</option>
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
        <div className="text-ink-faint text-sm py-8 text-center">Loading deliveries…</div>
      ) : (
        <DataTable
          columns={columns}
          rows={filtered}
          emptyMessage={
            rows.length === 0
              ? (canCreate ? 'No deliveries yet — click "+ New Delivery" to get started.' : "No deliveries yet.")
              : "No deliveries match the current filter."
          }
        />
      )}

      {showForm && (
        <Modal
          title={editing ? "Edit Delivery" : "New Delivery"}
          onClose={() => setShowForm(false)}
          wide
          footer={
            <>
              <Button onClick={() => setShowForm(false)} disabled={saving}>Cancel</Button>
              <Button variant="primary" type="submit" form="transport-form" disabled={saving}>
                {saving ? "Saving…" : editing ? "Save Changes" : "Save Delivery"}
              </Button>
            </>
          }
        >
          <form id="transport-form" onSubmit={save}>
            {formError && (
              <div className="mb-4 text-sm text-negative bg-negative-tint border border-negative-tint rounded-md px-3 py-2">
                {formError}
              </div>
            )}

            {/* ---- Link ------------------------------------------------ */}
            <h4 className="text-[13.5px] font-semibold mb-3">Link</h4>
            <div className="grid grid-cols-2 gap-3.5 mb-5 max-[560px]:grid-cols-1">
              <Field label="Linked to">
                <select
                  className={selectCls}
                  value={form.link_type}
                  onChange={(e) => setForm(f => ({
                    ...f,
                    link_type: e.target.value,
                    sale_id: "",
                    purchase_id: "",
                  }))}
                >
                  <option value="">Standalone delivery</option>
                  <option value="sale">Sale</option>
                  <option value="purchase">Purchase</option>
                </select>
              </Field>

              {form.link_type === "sale" && (
                <Field label="Sale">
                  <select
                    className={selectCls}
                    value={form.sale_id}
                    required
                    onChange={(e) => {
                      const saleId = e.target.value;
                      const sale = saleId ? saleById.get(Number(saleId)) : null;
                      setForm(f => ({
                        ...f,
                        sale_id: saleId,
                        customer_id: sale?.customer_id || f.customer_id,
                        load_kg: sale?.net_qty ?? f.load_kg,
                      }));
                    }}
                  >
                    <option value="">— select sale —</option>
                    {sales.map(s => (
                      <option key={s.id} value={s.id}>
                        {s.invoice} · {s.product} · {num(s.net_qty).toLocaleString("en-IN")} kg
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              {form.link_type === "purchase" && (
                <Field label="Purchase">
                  <select
                    className={selectCls}
                    value={form.purchase_id}
                    required
                    onChange={(e) => {
                      const pId = e.target.value;
                      const pur = pId ? purchaseById.get(Number(pId)) : null;
                      setForm(f => ({
                        ...f,
                        purchase_id: pId,
                        load_kg: pur?.net_qty ?? f.load_kg,
                      }));
                    }}
                  >
                    <option value="">— select purchase —</option>
                    {purchases.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.invoice} · {p.material} · {num(p.net_qty).toLocaleString("en-IN")} kg
                      </option>
                    ))}
                  </select>
                </Field>
              )}

              {form.link_type === "" && (
                <Field label="Customer (optional)">
                  <select
                    className={selectCls}
                    value={form.customer_id}
                    onChange={(e) => setForm(f => ({ ...f, customer_id: e.target.value }))}
                  >
                    <option value="">— none —</option>
                    {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </Field>
              )}
            </div>

            {/* ---- Route & vehicle ------------------------------------ */}
            <h4 className="text-[13.5px] font-semibold mb-3 pt-4 border-t border-dashed border-line">
              Route &amp; Vehicle
            </h4>
            <div className="grid grid-cols-2 gap-3.5 mb-5 max-[560px]:grid-cols-1">
              <Field label="Vehicle No.">
                <input className={inputCls} value={form.vehicle}
                  onChange={(e) => setForm(f => ({ ...f, vehicle: e.target.value }))}
                  placeholder="BA 1 KHA 1234" />
              </Field>
              <Field label="Driver Name">
                <input className={inputCls} value={form.driver}
                  onChange={(e) => setForm(f => ({ ...f, driver: e.target.value }))} />
              </Field>
              <Field label="Driver Phone">
                <input className={inputCls} value={form.driver_phone}
                  onChange={(e) => setForm(f => ({ ...f, driver_phone: e.target.value }))}
                  placeholder="98XXXXXXXX" />
              </Field>
              <Field label="Loader">
                <input className={inputCls} value={form.loader}
                  onChange={(e) => setForm(f => ({ ...f, loader: e.target.value }))} />
              </Field>
              <Field label="From">
                <input className={inputCls} value={form.from_location}
                  onChange={(e) => setForm(f => ({ ...f, from_location: e.target.value }))}
                  placeholder="Yard / warehouse" />
              </Field>
              <Field label="To">
                <input className={inputCls} value={form.to_location}
                  onChange={(e) => setForm(f => ({ ...f, to_location: e.target.value }))}
                  placeholder="Destination" />
              </Field>
              <Field label="Load (kg)">
                <input type="number" min="0" step="0.001" className={inputCls} value={form.load_kg}
                  onChange={(e) => setForm(f => ({ ...f, load_kg: e.target.value }))} />
              </Field>
              <Field label="Status">
                <select className={selectCls} value={form.status}
                  onChange={(e) => setForm(f => ({ ...f, status: e.target.value }))}>
                  <option value="Delivered">Delivered</option>
                  <option value="In Transit">In Transit</option>
                </select>
              </Field>
            </div>

            {/* ---- Dates ---------------------------------------------- */}
            <h4 className="text-[13.5px] font-semibold mb-3 pt-4 border-t border-dashed border-line">
              Dates
            </h4>
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
            </div>

            {/* ---- Costs ---------------------------------------------- */}
            <h4 className="text-[13.5px] font-semibold mb-3 pt-4 border-t border-dashed border-line">
              Costs
            </h4>
            <div className="grid grid-cols-2 gap-3.5 mb-3.5 max-[560px]:grid-cols-1">
              <Field label="Transport Fee (Rs)">
                <input type="number" min="0" step="0.01" className={inputCls} value={form.fee}
                  onChange={(e) => setForm(f => ({ ...f, fee: e.target.value }))} />
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
              <Field label="Total Cost (computed)" span={2}>
                <div className={inputCls + " !bg-steel-tint !text-steel-dark font-semibold !text-[15px]"}>
                  Rs. {computed.totalCost.toLocaleString("en-IN")}
                </div>
              </Field>
            </div>
          </form>
        </Modal>
      )}

      {toDelete && (
        <ConfirmDialog
          title="Delete delivery?"
          message="Delete this delivery record? The linked sale or purchase is unaffected."
          onCancel={() => setToDelete(null)}
          onConfirm={confirmDelete}
          busy={deleting}
        />
      )}
    </>
  );
}
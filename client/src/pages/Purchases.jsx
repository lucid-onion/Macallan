/* ==========================================================================
   Purchases.jsx — "All Scrap Nepal" style purchase entry.
   Fields and layout mirror the printed truck slip; the optional Payment
   block logs a real transaction (purchase_payment, direction=out).
   ========================================================================== */
import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import {
  Button, Modal, Field, ConfirmDialog, Badge, PageHeader,
  inputCls, selectCls,
} from "../components/ui";
import DataTable from "../components/DataTable";
import { printVoucher } from "../lib/printVoucher";
import { bsToday, bsToAdString, adToBs, formatBs } from "../lib/nepali-date";

const todayBs = bsToday();

const EMPTY_FORM = {
  supplier_id: "",
  invoice: "",
  material: "",

  date_bs_year:  todayBs.year,
  date_bs_month: todayBs.month,
  date_bs_day:   todayBs.day,
  date_ad:       bsToAdString(todayBs),

  gross_qty: "",
  dust_qty: "0",
  rate: "",

  contact_person: "",
  contact_phone: "",

  truck_weight_kg: "",
  truck_no: "",
  truck_driver: "",
  truck_driver_phone: "",
  from_location: "",
  to_location: "",
  loader_name: "",

  transport_fee: "0",
  labor_charge: "0",
  road_expense: "0",
  tax_gbse: "0",

  amount_paid: "0",
  payment_method: "Cash",
  cash_source: "",
  paid_by: "",
  signature: "",

  status: "Delivered",
  company: "ASN Demolition Pvt.Ltd",
};

const num = (v) => { const n = Number(v); return isFinite(n) ? n : 0; };
const rupees = (v) => `Rs. ${num(v).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const kg = (v) => `${num(v).toLocaleString("en-US", { maximumFractionDigits: 2 })} kg`;
const adStr = (r) => (r.date_ad ? String(r.date_ad).slice(0, 10) : "—");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
);

export default function Purchases() {
  const { has, canDelete  } = useAuth();
  const canCreate = has("purchases", "create");
  const canUpdate = has("purchases", "update");
  const canDel    = canDelete("purchases");
  
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

  const [detail, setDetail] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  /* ---------- Load ---------- */
  async function load() {
    setLoading(true); setError(null);
    try {
      const [p, s] = await Promise.all([
        api.get("/api/purchases"),
        api.get("/api/suppliers"),
      ]);
      setRows(p.items || []);
      setSuppliers(s.items || []);
    } catch (e) {
      setError(e.message || "Failed to load purchases");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  /* ---------- Live computations ---------- */
  const computed = useMemo(() => {
    const gross = num(form.gross_qty);
    const dust  = num(form.dust_qty);
    const net   = Math.max(0, gross - dust);
    const rate  = num(form.rate);
    const total = net * rate;
    const transportTotal =
      num(form.transport_fee) + num(form.labor_charge) +
      num(form.road_expense) + num(form.tax_gbse);
    const due = Math.max(0, total - num(form.amount_paid));
    return { gross, dust, net, rate, total, transportTotal, due };
  }, [
    form.gross_qty, form.dust_qty, form.rate,
    form.transport_fee, form.labor_charge, form.road_expense, form.tax_gbse,
    form.amount_paid,
  ]);

  /* BS <-> AD live sync */
  useEffect(() => {
    if (!showForm) return;
    const y = Number(form.date_bs_year);
    const m = Number(form.date_bs_month);
    const d = Number(form.date_bs_day);
    if (!y || !m || !d) return;
    try {
      const s = bsToAdString({ year: y, month: m, day: d });
      if (s !== form.date_ad) setForm((f) => ({ ...f, date_ad: s }));
    } catch { /* invalid combination */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.date_bs_year, form.date_bs_month, form.date_bs_day, showForm]);

  /* ---------- Filters ---------- */
  const supplierNameById = useMemo(() => {
    const m = new Map();
    suppliers.forEach((s) => m.set(s.id, s.name));
    return m;
  }, [suppliers]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter && r.status !== statusFilter) return false;
      if (supplierFilter && String(r.supplier_id) !== supplierFilter) return false;
      if (!q) return true;
      return (
        (r.invoice || "").toLowerCase().includes(q) ||
        (r.material || "").toLowerCase().includes(q) ||
        (supplierNameById.get(r.supplier_id) || "").toLowerCase().includes(q)
      );
    });
  }, [rows, search, statusFilter, supplierFilter, supplierNameById]);

  const stats = useMemo(() => {
    const total = rows.reduce((s, r) => s + num(r.total), 0);
    const qty   = rows.reduce((s, r) => s + num(r.net_qty), 0);
    const transportTotal = rows.reduce(
      (s, r) => s + num(r.transport_fee) + num(r.labor_charge) + num(r.road_expense) + num(r.tax_gbse),
      0
    );
    const delivered = rows.filter((r) => r.status === "Delivered").length;
    return [
      { label: "Total Purchases", value: rupees(total) },
      { label: "Steel Purchased", value: kg(qty) },
      { label: "Transport Cost",  value: rupees(transportTotal) },
      { label: "Delivered",       value: `${delivered} / ${rows.length}` },
    ];
  }, [rows]);

  /* ---------- Form actions ---------- */
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

      date_bs_year:  row.date_bs_year  || todayBs.year,
      date_bs_month: row.date_bs_month || todayBs.month,
      date_bs_day:   row.date_bs_day   || todayBs.day,
      date_ad:       row.date_ad ? String(row.date_ad).slice(0, 10) : bsToAdString(todayBs),

      gross_qty: row.gross_qty ?? "",
      dust_qty:  row.dust_qty  ?? "0",
      rate:      row.rate      ?? "",

      contact_person: row.contact_person || "",
      contact_phone:  row.contact_phone  || "",

      truck_weight_kg:    row.truck_weight_kg ?? "",
      truck_no:           row.truck_no || "",
      truck_driver:       row.truck_driver || "",
      truck_driver_phone: row.truck_driver_phone || "",
      from_location:      row.from_location || "",
      to_location:        row.to_location || "",
      loader_name:        row.loader_name || "",

      transport_fee: row.transport_fee ?? "0",
      labor_charge:  row.labor_charge  ?? "0",
      road_expense:  row.road_expense  ?? "0",
      tax_gbse:      row.tax_gbse      ?? "0",

      amount_paid: "0",
      payment_method: "Cash",
      cash_source: row.cash_source || "",
      paid_by:     row.paid_by     || "",
      signature:   row.signature   || "",

      status:  row.status  || "Delivered",
      company: row.company || "ASN Demolition Pvt.Ltd",
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
        invoice:     form.invoice.trim(),
        supplier_id: Number(form.supplier_id),
        material:    form.material.trim(),

        date_bs_year:  Number(form.date_bs_year),
        date_bs_month: Number(form.date_bs_month),
        date_bs_day:   Number(form.date_bs_day),
        date_ad:       form.date_ad,

        gross_qty: computed.gross,
        dust_qty:  computed.dust,
        net_qty:   computed.net,
        rate:      computed.rate,
        total:     computed.total,

        contact_person: form.contact_person.trim() || undefined,
        contact_phone:  form.contact_phone.trim()  || undefined,

        truck_weight_kg:    num(form.truck_weight_kg) || undefined,
        truck_no:           form.truck_no.trim()           || undefined,
        truck_driver:       form.truck_driver.trim()       || undefined,
        truck_driver_phone: form.truck_driver_phone.trim() || undefined,
        from_location:      form.from_location.trim()      || undefined,
        to_location:        form.to_location.trim()        || undefined,
        loader_name:        form.loader_name.trim()        || undefined,

        transport_fee: num(form.transport_fee),
        labor_charge:  num(form.labor_charge),
        road_expense:  num(form.road_expense),
        tax_gbse:      num(form.tax_gbse),

        status:  form.status,
        company: form.company.trim() || undefined,
      };

      // Only send payment fields on create — editing is parent-only.
      if (!editing) {
        payload.amount_paid     = num(form.amount_paid);
        payload.payment_method  = form.payment_method;
        payload.cash_source     = form.cash_source.trim() || undefined;
        payload.paid_by         = form.paid_by.trim()     || undefined;
        payload.signature       = form.signature.trim()   || undefined;
      }

      if (!payload.invoice)      { setFormError("Invoice is required.");                 return; }
      if (!payload.supplier_id)  { setFormError("Select a supplier.");                   return; }
      if (!payload.material)     { setFormError("Material is required.");                return; }
      if (payload.gross_qty <= 0){ setFormError("Gross quantity must be positive.");     return; }
      if (payload.rate <= 0)     { setFormError("Rate must be positive.");               return; }

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

  /* ---------- Print ---------- */
  async function fetchPaymentsForPurchase(id) {
    try {
      const { items } = await api.get("/api/transactions");
      return (items || []).filter(
        (t) => t.ref_type === "purchase" && Number(t.ref_id) === Number(id)
      );
    } catch {
      return [];
    }
  }

  async function printPurchaseInvoice(row) {
    const supplierName = supplierNameById.get(row.supplier_id) || "—";
    const payments = await fetchPaymentsForPurchase(row.id);
    const paidTotal = payments.reduce((s, p) => s + num(p.amount), 0);
    const due = Math.max(0, num(row.total) - paidTotal);

    const transportTotal =
      num(row.transport_fee) + num(row.labor_charge) +
      num(row.road_expense) + num(row.tax_gbse);

    const paymentRows = payments.map((p) => `
      <tr>
        <td>${esc(formatBs(p))}</td>
        <td>${esc(p.method || "-")}</td>
        <td>${esc(p.note || "-")}</td>
        <td class="num">${esc(rupees(p.amount))}</td>
      </tr>`).join("");

    const html = `
      <div class="doc-sheet">
        <div class="doc-letterhead">
          <div class="doc-brand">
            <div class="doc-company">${esc(row.company || "ASN Demolition Pvt.Ltd")}</div>
          </div>
          <div class="doc-kind">
            <div class="doc-title">Purchase Invoice</div>
            <div class="doc-no">No. ${esc(row.invoice)}</div>
          </div>
        </div>

        <div class="doc-meta">
          <div>Date (BS)<strong>${esc(formatBs(row))}</strong></div>
          <div>Date (English)<strong>${esc(adStr(row))}</strong></div>
          <div>Company<strong>${esc(row.company || "ASN Demolition Pvt.Ltd")}</strong></div>
          <div>Status<strong>${esc(row.status || "Delivered")}</strong></div>
        </div>

        <div class="doc-two-col">
          <div class="doc-box">
            <div class="doc-box-title">Purchased From (Supplier)</div>
            <div class="doc-box-main">${esc(supplierName)}</div>
            ${(row.contact_person || row.contact_phone)
              ? `<div class="doc-box-sub">${esc([row.contact_person, row.contact_phone].filter(Boolean).join(" · "))}</div>`
              : ""}
          </div>
          <div class="doc-box">
            <div class="doc-box-title">Billed To</div>
            <div class="doc-box-main">${esc(row.company || "ASN Demolition Pvt.Ltd")}</div>
          </div>
        </div>

        <div class="doc-section-title">Product Details</div>
        <table class="doc-table">
          <thead>
            <tr>
              <th>Material</th>
              <th class="num">Gross Qty</th>
              <th class="num">Dust</th>
              <th class="num">Net Qty</th>
              <th class="num">Rate / kg</th>
              <th class="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>${esc(row.material || "—")}</td>
              <td class="num">${esc(kg(row.gross_qty))}</td>
              <td class="num">${esc(kg(row.dust_qty))}</td>
              <td class="num">${esc(kg(row.net_qty))}</td>
              <td class="num">${esc(rupees(row.rate))}</td>
              <td class="num">${esc(rupees(row.total))}</td>
            </tr>
          </tbody>
        </table>

        ${payments.length ? `
          <div class="doc-section-title">Payments Made</div>
          <table class="doc-table">
            <thead>
              <tr>
                <th>Date (BS)</th>
                <th>Method</th>
                <th>Note</th>
                <th class="num">Amount</th>
              </tr>
            </thead>
            <tbody>${paymentRows}</tbody>
          </table>` : ""}

        <div class="doc-summary">
          <div><span>Total Amount (product)</span><span>${esc(rupees(row.total))}</span></div>
          <div><span>Paid</span><span>${esc(rupees(paidTotal))}</span></div>
          <div class="doc-summary-strong"><span>Balance Due (product only)</span><span>${esc(rupees(due))}</span></div>
        </div>

        ${transportTotal > 0 ? `
          <div class="doc-section-title">Transportation Cost</div>
          <div class="doc-summary">
            <div><span>Transport Fee</span><span>${esc(rupees(row.transport_fee || 0))}</span></div>
            <div><span>Labor Charge</span><span>${esc(rupees(row.labor_charge || 0))}</span></div>
            <div><span>Road Expense</span><span>${esc(rupees(row.road_expense || 0))}</span></div>
            <div><span>Tax (G.B.S.E)</span><span>${esc(rupees(row.tax_gbse || 0))}</span></div>
            <div class="doc-summary-strong"><span>Total Transport Cost</span><span>${esc(rupees(transportTotal))}</span></div>
          </div>` : ""}

        <div class="doc-signatures">
          <div>Received By${row.signature ? ": " + esc(row.signature) : ""}</div>
          <div>Authorized By${row.paid_by ? ": " + esc(row.paid_by) : ""}</div>
        </div>

        <div class="doc-foot">
          Printed on ${esc(new Date().toLocaleString())} from ${esc(row.company || "ASN Demolition Pvt.Ltd")} management system.
        </div>
      </div>`;

    printVoucher(html);
  }

  /* ---------- Table columns ---------- */
  const columns = [
    { key: "date_bs", label: "Date (BS)", render: (r) => formatBs(r) },
    { key: "date_ad", label: "Date (EN)", render: (r) => adStr(r) },
    { key: "invoice", label: "Invoice" },
    { key: "supplier", label: "Supplier",
      render: (r) => supplierNameById.get(r.supplier_id) || "—" },
    { key: "material", label: "Material" },
    { key: "gross_qty", label: "Gross", numeric: true, render: (r) => kg(r.gross_qty) },
    { key: "dust_qty",  label: "Dust",  numeric: true, render: (r) => kg(r.dust_qty) },
    { key: "net_qty",   label: "Net",   numeric: true, render: (r) => kg(r.net_qty) },
    { key: "rate",      label: "Rate",  numeric: true, render: (r) => `${rupees(r.rate)}/kg` },
    { key: "total", label: "Total", numeric: true, render: (r) => rupees(r.total) },
    { key: "paid_amount", label: "Paid", numeric: true,
      render: (r) => (
        <span className="text-positive">{rupees(r.paid_amount || 0)}</span>
      ) },
    { key: "due_amount", label: "Balance", numeric: true,
      render: (r) => {
        const due = r.due_amount || 0;
        return (
          <span className={due > 0 ? "text-negative" : "text-ink-faint"}>
            {rupees(due)}
          </span>
        );
      } },
    { key: "status", label: "Status",
      render: (r) => (
        <Badge variant={r.status === "Delivered" ? "positive" : "warning"}>{r.status}</Badge>
      ) },
    { key: "actions", label: "", render: (r) => (
      <div className="flex gap-1.5 justify-end">
        {canUpdate && (
          <button type="button"
            onClick={(e) => { e.stopPropagation(); openEdit(r); }}
            className="text-steel text-xs hover:underline">Edit</button>
        )}
        {canDel && (
          <button type="button"
            onClick={(e) => { e.stopPropagation(); setToDelete(r); }}
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

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 mb-[18px] max-[980px]:grid-cols-2 max-[520px]:grid-cols-1">
        {stats.map((s, i) => (
          <div key={i} className="bg-surface-sunken border border-line-soft rounded-sm px-3.5 py-[13px]">
            <div className="text-[11.5px] text-ink-faint mb-1.5">{s.label}</div>
            <div className="text-base font-semibold tabular-nums">{s.value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap bg-surface border border-line rounded-md p-2.5 mb-6">
        <label htmlFor="pur-search" className="text-xs text-ink-faint pl-1">Search</label>
        <input id="pur-search" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Invoice, material, supplier" className={inputCls + " !w-64"} />

        <label htmlFor="pur-supplier" className="text-xs text-ink-faint pl-1">Supplier</label>
        <select id="pur-supplier" value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)}
          className={selectCls + " !w-auto"}>
          <option value="">All suppliers</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
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
          onRowClick={(row) => setDetail(row)}
          emptyMessage={
            rows.length === 0
              ? (canCreate ? 'No purchases yet — click "+ New Purchase" to get started.' : "No purchases yet.")
              : "No purchases match the current filter."
          }
        />
      )}

      {/* Detail modal */}
      {detail && (
        <Modal
          title={`Purchase Detail — ${detail.invoice}`}
          onClose={() => setDetail(null)}
          wide
          footer={
            <>
              <Button onClick={() => printPurchaseInvoice(detail)}>Print</Button>
              <Button onClick={() => setDetail(null)}>Close</Button>
            </>
          }
        >
          <div className="grid grid-cols-2 gap-x-5 gap-y-2.5 mb-4 max-[560px]:grid-cols-1">
            <DetailPair label="Paid So Far" value={<span className="text-positive">{rupees(detail.paid_amount || 0)}</span>}/>
            <DetailPair label="Balance Due" value={<span className={(detail.due_amount || 0) > 0 ? "text-negative" : "text-ink-faint"}>{rupees(detail.due_amount || 0)}</span>}/>
            <DetailPair label="Supplier" value={supplierNameById.get(detail.supplier_id) || "—"} />
            <DetailPair label="Person Name" value={detail.contact_person || "—"} />
            <DetailPair label="Phone Number" value={detail.contact_phone || "—"} />
            <DetailPair label="Company" value={detail.company || "—"} />
            <DetailPair label="Date (BS)" value={formatBs(detail)} />
            <DetailPair label="Date (EN)" value={adStr(detail)} />
            <DetailPair label="Material" value={detail.material || "—"} />
            <DetailPair label="Status" value={detail.status || "—"} />
            <DetailPair label="Gross / Dust / Net"
              value={`${kg(detail.gross_qty)} / ${kg(detail.dust_qty)} / ${kg(detail.net_qty)}`} />
            <DetailPair label="Rate" value={`${rupees(detail.rate)}/kg`} />
            <DetailPair label="Total (product)" value={rupees(detail.total)} />
            <DetailPair label="Transport Cost"
              value={rupees(
                num(detail.transport_fee) + num(detail.labor_charge) +
                num(detail.road_expense) + num(detail.tax_gbse)
              )} />
            <DetailPair label="Truck No." value={detail.truck_no || "—"} />
            <DetailPair label="Driver" value={detail.truck_driver || "—"} />
            <DetailPair label="Driver Phone" value={detail.truck_driver_phone || "—"} />
            <DetailPair label="Loader" value={detail.loader_name || "—"} />
            <DetailPair label="From" value={detail.from_location || "—"} />
            <DetailPair label="To" value={detail.to_location || "—"} />
          </div>
        </Modal>
      )}

      {/* Create / edit modal */}
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

            <p className="text-[12px] text-ink-faint bg-surface-sunken rounded-sm px-3 py-2 mb-4">
              Purchased quantity (net, after dust) is added automatically to Inventory if the material name matches an existing item.
            </p>

            <div className="grid grid-cols-2 gap-3.5 mb-5 max-[560px]:grid-cols-1">
              <Field label="Supplier" span={2}>
                <select className={selectCls} value={form.supplier_id} required
                  onChange={(e) => setForm((f) => ({ ...f, supplier_id: e.target.value }))}>
                  <option value="">— select —</option>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
              <Field label="Person Name">
                <input className={inputCls} value={form.contact_person}
                  onChange={(e) => setForm((f) => ({ ...f, contact_person: e.target.value }))}
                  placeholder="Person in charge" />
              </Field>
              <Field label="Phone Number">
                <input className={inputCls} value={form.contact_phone}
                  onChange={(e) => setForm((f) => ({ ...f, contact_phone: e.target.value }))}
                  placeholder="98XXXXXXXX" />
              </Field>

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
              <Field label="Date (AD)" hint="auto-synced with BS">
                <input type="date" className={inputCls} value={form.date_ad}
                  onChange={(e) => {
                    const ad = e.target.value;
                    setForm((f) => ({ ...f, date_ad: ad }));
                    try {
                      const d = new Date(ad);
                      if (!isNaN(d)) {
                        const bs = adToBs(d);
                        setForm((f) => ({
                          ...f,
                          date_bs_year: bs.year, date_bs_month: bs.month, date_bs_day: bs.day, date_ad: ad,
                        }));
                      }
                    } catch { /* ignore */ }
                  }} />
              </Field>

              <Field label="Invoice #">
                <input className={inputCls} value={form.invoice} required
                  onChange={(e) => setForm((f) => ({ ...f, invoice: e.target.value }))} />
              </Field>
              <Field label="Material">
                <input className={inputCls} value={form.material} required
                  placeholder="e.g. TMT Rod 12mm"
                  onChange={(e) => setForm((f) => ({ ...f, material: e.target.value }))} />
              </Field>

              <Field label="Gross Qty (kg)">
                <input type="number" min="0" step="0.001" className={inputCls} value={form.gross_qty} required
                  onChange={(e) => setForm((f) => ({ ...f, gross_qty: e.target.value }))} />
              </Field>
              <Field label="Dust (kg)">
                <input type="number" min="0" step="0.001" className={inputCls} value={form.dust_qty}
                  onChange={(e) => setForm((f) => ({ ...f, dust_qty: e.target.value }))} />
              </Field>
              <Field label="Net Qty (computed)">
                <div className={inputCls + " !bg-steel-tint !text-steel-dark font-semibold"}>
                  {kg(computed.net)}
                </div>
              </Field>
              <Field label="Rate (Rs/kg)">
                <input type="number" min="0" step="0.01" className={inputCls} value={form.rate} required
                  onChange={(e) => setForm((f) => ({ ...f, rate: e.target.value }))} />
              </Field>

              <Field label="Total (real product amount)" span={2}>
                <div className={inputCls + " !bg-steel-tint !text-steel-dark font-semibold !text-[15px]"}>
                  {rupees(computed.total)}
                </div>
              </Field>

              <Field label="Status">
                <select className={selectCls} value={form.status}
                  onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
                  <option value="Delivered">Delivered</option>
                  <option value="Pending">Pending</option>
                </select>
              </Field>
              <Field label="Company">
                <input className={inputCls} value={form.company}
                  onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))} />
              </Field>
            </div>

            {/* ---- Truck & Transport ---- */}
            <h4 className="text-[13.5px] font-semibold mb-2 pt-4 border-t border-dashed border-line">
              Truck &amp; Transport Detail (required)
            </h4>
            <p className="text-[11.5px] text-ink-faint bg-surface-sunken rounded-sm px-3 py-2 mb-4">
              Matches the printed "All Scrap Nepal" truck-detail slip. This is also what gets saved as this purchase's delivery on the Transportation page — no separate delivery entry needed.
            </p>

            <div className="grid grid-cols-2 gap-3.5 mb-5 max-[560px]:grid-cols-1">
              <Field label="Truck Weight (kg)">
                <input type="number" min="0" step="0.01" className={inputCls} value={form.truck_weight_kg}
                  onChange={(e) => setForm((f) => ({ ...f, truck_weight_kg: e.target.value }))} />
              </Field>
              <Field label="Truck No.">
                <input className={inputCls} value={form.truck_no}
                  onChange={(e) => setForm((f) => ({ ...f, truck_no: e.target.value }))}
                  placeholder="BA 1 KHA 1234" />
              </Field>
              <Field label="Driver Name">
                <input className={inputCls} value={form.truck_driver}
                  onChange={(e) => setForm((f) => ({ ...f, truck_driver: e.target.value }))}
                  placeholder="Driver's full name" />
              </Field>
              <Field label="Driver No.">
                <input className={inputCls} value={form.truck_driver_phone}
                  onChange={(e) => setForm((f) => ({ ...f, truck_driver_phone: e.target.value }))}
                  placeholder="98XXXXXXXX" />
              </Field>
              <Field label="From">
                <input className={inputCls} value={form.from_location}
                  onChange={(e) => setForm((f) => ({ ...f, from_location: e.target.value }))}
                  placeholder="Yard / warehouse address" />
              </Field>
              <Field label="To">
                <input className={inputCls} value={form.to_location}
                  onChange={(e) => setForm((f) => ({ ...f, to_location: e.target.value }))}
                  placeholder="Destination" />
              </Field>
              <Field label="Loader Name">
                <input className={inputCls} value={form.loader_name}
                  onChange={(e) => setForm((f) => ({ ...f, loader_name: e.target.value }))}
                  placeholder="Responsible loading person" />
              </Field>
              <Field label="Transport Fee (Rs)">
                <input type="number" min="0" step="0.01" className={inputCls} value={form.transport_fee}
                  onChange={(e) => setForm((f) => ({ ...f, transport_fee: e.target.value }))} />
              </Field>
              <Field label="Labor Charge (Rs)">
                <input type="number" min="0" step="0.01" className={inputCls} value={form.labor_charge}
                  onChange={(e) => setForm((f) => ({ ...f, labor_charge: e.target.value }))} />
              </Field>
              <Field label="Road Expenses (Rs)">
                <input type="number" min="0" step="0.01" className={inputCls} value={form.road_expense}
                  onChange={(e) => setForm((f) => ({ ...f, road_expense: e.target.value }))} />
              </Field>
              <Field label="Tax Paid (G.B.S.E) (Rs)">
                <input type="number" min="0" step="0.01" className={inputCls} value={form.tax_gbse}
                  onChange={(e) => setForm((f) => ({ ...f, tax_gbse: e.target.value }))} />
              </Field>
              <Field label="Total Transport Cost" hint="(fee + labor + road + tax)">
                <div className={inputCls + " !bg-steel-tint !text-steel-dark font-semibold"}>
                  {rupees(computed.transportTotal)}
                </div>
              </Field>
            </div>

            {/* ---- Payment (CREATE only) — lives inside the purchase form
                 because its fields ride along with the purchase POST ---- */}
            {!editing && (
              <>
                <h4 className="text-[13.5px] font-semibold mb-2 pt-4 border-t border-dashed border-line">
                  Payment (optional)
                </h4>
                <p className="text-[11.5px] text-ink-faint bg-surface-sunken rounded-sm px-3 py-2 mb-4">
                  If you pay the supplier something right away, enter it here — it's logged as a transaction automatically.
                  Leave at 0 if nothing is paid yet; the rest can be paid anytime from the Transactions page. This only
                  covers the steel — transport, labor, road and tax costs above are separate and don't reduce what's owed to the supplier.
                </p>

                <div className="grid grid-cols-2 gap-3.5 mb-3.5 max-[560px]:grid-cols-1">
                  <Field label="Amount Paid Now (Rs)">
                    <input type="number" min="0" step="0.01" className={inputCls} value={form.amount_paid}
                      onChange={(e) => setForm((f) => ({ ...f, amount_paid: e.target.value }))} />
                  </Field>
                  <Field label="Cash / Online">
                    <select className={selectCls} value={form.payment_method}
                      onChange={(e) => setForm((f) => ({ ...f, payment_method: e.target.value }))}>
                      <option value="Cash">Cash</option>
                      <option value="Online">Online</option>
                    </select>
                  </Field>
                  <Field label="Cash Source">
                    <input className={inputCls} value={form.cash_source}
                      onChange={(e) => setForm((f) => ({ ...f, cash_source: e.target.value }))}
                      placeholder="e.g. Office cash / Bank" />
                  </Field>
                  <Field label="Due After This">
                    <div className={inputCls + " !bg-steel-tint !text-steel-dark font-semibold"}>
                      {rupees(computed.due)}
                    </div>
                  </Field>
                  <Field label="Paid By">
                    <input className={inputCls} value={form.paid_by}
                      onChange={(e) => setForm((f) => ({ ...f, paid_by: e.target.value }))}
                      placeholder="Who handled the payment" />
                  </Field>
                  <Field label="Signature / Received By">
                    <input className={inputCls} value={form.signature}
                      onChange={(e) => setForm((f) => ({ ...f, signature: e.target.value }))}
                      placeholder="Name confirming the slip" />
                  </Field>
                </div>
              </>
            )}
          </form>

          {/* ---- Payment ledger (EDIT only) — deliberately OUTSIDE the
               purchase <form> so no nested-form bug can hijack submits. ---- */}
          {editing && (
            <div className="mt-5">
              <EditPaymentBlock
                purchase={editing}
                supplierName={supplierNameById.get(editing.supplier_id) || ""}
                onPaid={load}
              />
            </div>
          )}
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

/* -------------------------------------------------------------------------
   DetailPair — small read-only label/value in the detail modal.
   ------------------------------------------------------------------------- */
function DetailPair({ label, value }) {
  return (
    <div>
      <div className="text-[11.5px] text-ink-faint mb-0.5">{label}</div>
      <div className="text-[13.5px] font-medium">{value}</div>
    </div>
  );
}

/* -------------------------------------------------------------------------
   EditPaymentBlock — shown inside the Edit Purchase modal, but outside the
   purchase form. Lets the user log an additional payment (or the first
   partial payment) against this purchase. Posts a transactions record with
   ref_type='purchase', ref_id=<id>, direction='out'.
   ------------------------------------------------------------------------- */
function EditPaymentBlock({ purchase, supplierName, onPaid }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("Cash");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [done, setDone] = useState(null);

  const [payments, setPayments] = useState([]);
  const [loadingPayments, setLoadingPayments] = useState(true);

  async function reloadPayments() {
    setLoadingPayments(true);
    try {
      const { items } = await api.get("/api/transactions");
      setPayments(
        (items || []).filter(
          (t) => t.ref_type === "purchase" && Number(t.ref_id) === Number(purchase.id)
        )
      );
    } catch {
      setPayments([]);
    } finally {
      setLoadingPayments(false);
    }
  }
  useEffect(() => { reloadPayments(); /* eslint-disable-next-line */ }, [purchase.id]);

  const paidSoFar = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
  const total = Number(purchase.total || 0);
  const due = Math.max(0, total - paidSoFar);

  // Default the payment's BS date to the purchase's own date.
  const bs = {
    year:  purchase.date_bs_year  || 2083,
    month: purchase.date_bs_month || 1,
    day:   purchase.date_bs_day   || 1,
  };
  const ad = purchase.date_ad
    ? String(purchase.date_ad).slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  async function submit() {
    setErr(null);
    setDone(null);
    const amt = Number(amount);
    if (!amt || amt <= 0) { setErr("Enter an amount greater than zero."); return; }
    setBusy(true);
    try {
      const payload = {
        type: "purchase_payment",
        party_type: "supplier",
        party_key: String(purchase.supplier_id),
        direction: "out",
        amount: amt,
        method,
        ref_type: "purchase",
        ref_id: purchase.id,
        date_bs_year:  bs.year,
        date_bs_month: bs.month,
        date_bs_day:   bs.day,
        date_ad:       ad,
        company:       purchase.company || undefined,
        note:          note.trim() || "Additional payment",
      };
      // Only attach when non-empty — the server's Zod schema allows the key
      // to be missing but not explicitly null.
      if (supplierName) payload.party_label = supplierName;

      await api.post("/api/transactions", payload);

      setAmount("");
      setNote("");
      setDone(`Logged ${amt.toLocaleString("en-IN")} as a new payment.`);
      await reloadPayments();
      if (onPaid) onPaid();
    } catch (e) {
      setErr(e.message || "Could not save payment");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h4 className="text-[13.5px] font-semibold mb-2 pt-4 border-t border-dashed border-line">
        Payments
      </h4>
      <p className="text-[11.5px] text-ink-faint bg-surface-sunken rounded-sm px-3 py-2 mb-4">
        Payments are separate ledger entries — adding one here doesn't change this purchase's amount,
        it just reduces the supplier's outstanding balance. To edit a purchase's amount, change the
        quantities or rate above.
      </p>

      {/* Paid-so-far summary */}
      <div className="grid grid-cols-3 gap-3 mb-4 max-[560px]:grid-cols-1">
        <div className="bg-surface-sunken border border-line-soft rounded-sm px-3 py-2">
          <div className="text-[11px] text-ink-faint mb-1">Total</div>
          <div className="text-sm font-semibold tabular-nums">{rupees(total)}</div>
        </div>
        <div className="bg-surface-sunken border border-line-soft rounded-sm px-3 py-2">
          <div className="text-[11px] text-ink-faint mb-1">Paid so far</div>
          <div className="text-sm font-semibold tabular-nums text-positive">{rupees(paidSoFar)}</div>
        </div>
        <div className="bg-surface-sunken border border-line-soft rounded-sm px-3 py-2">
          <div className="text-[11px] text-ink-faint mb-1">Balance due</div>
          <div className="text-sm font-semibold tabular-nums text-negative">{rupees(due)}</div>
        </div>
      </div>

      {/* Existing payments list */}
      {loadingPayments ? (
        <div className="text-[12px] text-ink-faint py-2">Loading payments…</div>
      ) : payments.length ? (
        <div className="border border-line rounded-sm overflow-hidden mb-4">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="text-[10.5px] uppercase tracking-[0.04em] text-ink-faint font-semibold text-left px-3 py-2 border-b border-line">Date (BS)</th>
                <th className="text-[10.5px] uppercase tracking-[0.04em] text-ink-faint font-semibold text-left px-3 py-2 border-b border-line">Method</th>
                <th className="text-[10.5px] uppercase tracking-[0.04em] text-ink-faint font-semibold text-left px-3 py-2 border-b border-line">Note</th>
                <th className="text-[10.5px] uppercase tracking-[0.04em] text-ink-faint font-semibold text-right px-3 py-2 border-b border-line">Amount</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <td className="px-3 py-1.5 border-b border-line-soft text-[12px]">
                    {p.date_bs_year}/{String(p.date_bs_month).padStart(2, "0")}/{String(p.date_bs_day).padStart(2, "0")}
                  </td>
                  <td className="px-3 py-1.5 border-b border-line-soft text-[12px]">{p.method || "—"}</td>
                  <td className="px-3 py-1.5 border-b border-line-soft text-[12px]">{p.note || "—"}</td>
                  <td className="px-3 py-1.5 border-b border-line-soft text-[12px] text-right tabular-nums">{rupees(p.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-[12px] text-ink-faint italic mb-4">No payments recorded yet.</div>
      )}

      {/* Add-payment form — no <form> element, buttons drive submit directly */}
      {open ? (
        <div className="border border-line rounded-sm p-3 bg-surface-sunken">
          {err && (
            <div className="mb-2 text-[12px] text-negative bg-negative-tint border border-negative-tint rounded-sm px-2 py-1.5">
              {err}
            </div>
          )}
          {done && !err && (
            <div className="mb-2 text-[12px] text-positive bg-positive-tint border border-positive-tint rounded-sm px-2 py-1.5">
              {done}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 mb-3 max-[560px]:grid-cols-1">
            <Field label="Amount (Rs)">
              <input
                type="number" min="0" step="0.01" className={inputCls}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}
                autoFocus
              />
            </Field>
            <Field label="Cash / Online">
              <select className={selectCls} value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="Cash">Cash</option>
                <option value="Online">Online</option>
              </select>
            </Field>
            <Field label="Note (optional)" span={2}>
              <input
                className={inputCls} value={note}
                onChange={(e) => setNote(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}
                placeholder="e.g. Second installment"
              />
            </Field>
          </div>
          <div className="flex gap-2 justify-end">
            <Button type="button" onClick={() => { setOpen(false); setErr(null); setDone(null); }} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" type="button" onClick={() => submit()} disabled={busy}>
              {busy ? "Saving…" : "Log Payment"}
            </Button>
          </div>
        </div>
      ) : (
        <Button onClick={() => setOpen(true)} size="sm" variant="primary">
          + Log Additional Payment
        </Button>
      )}
    </>
  );
}
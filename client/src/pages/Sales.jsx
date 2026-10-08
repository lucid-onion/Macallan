/* ==========================================================================
   Sales.jsx — sales register with installments.

   Money model:
     Total         = quantity × rate
     Report Amount = manual deduction (user-entered)
     Final Total   = Total − Report Amount  → stored in sales.total

   Payments received:
     Advance on create → one transaction
     Additional installments → transactions via POST /api/sales/:id/payments
     Auto-labeled: "First installment (Advance)", "Second installment", …
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
import {
  bsToday, bsToAdString, adToBs, formatBs,
  NEPALI_MONTHS, NEPALI_MONTHS_EN,
} from "../lib/nepali-date";

const BRAND = "ScrapLink Pvt.Ltd";
const todayBs = bsToday();

const EMPTY_FORM = {
  customer_id: "",
  invoice: "",
  product: "",

  date_bs_year:  todayBs.year,
  date_bs_month: todayBs.month,
  date_bs_day:   todayBs.day,
  date_ad:       bsToAdString(todayBs),

  gross_qty: "",
  dust_qty: "0",
  rate: "",
  report_amount: "0",

  amount_received: "0",
  payment_method: "Cash",
  cash_source: "",
  received_by: "",
  signature: "",

  status: "Delivered",
  company: BRAND,
};

const ORDINALS = [
  "", "First", "Second", "Third", "Fourth", "Fifth", "Sixth",
  "Seventh", "Eighth", "Ninth", "Tenth", "Eleventh", "Twelfth",
];
const ordinal = (n) => ORDINALS[n] || `#${n}`;

const num = (v) => { const n = Number(v); return isFinite(n) ? n : 0; };
const rupees = (v) => `Rs. ${num(v).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const kg = (v) => `${num(v).toLocaleString("en-US", { maximumFractionDigits: 2 })} kg`;
const adStr = (r) => (r.date_ad ? String(r.date_ad).slice(0, 10) : "—");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
);

const AD_MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function prettyAd(s) {
  if (!s) return "—";
  const [y, m, d] = String(s).slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return s;
  return `${d} ${AD_MONTHS[m - 1]} ${y}`;
}

const BS_MONTH_LENGTHS = {
  2070:[31,31,31,32,31,31,29,30,30,29,30,30],
  2071:[31,31,32,31,31,31,30,29,30,29,30,30],
  2072:[31,32,31,32,31,30,30,29,30,29,30,30],
  2073:[31,32,31,32,31,30,30,30,29,29,30,31],
  2074:[31,31,31,32,31,31,30,29,30,29,30,30],
  2075:[31,31,32,31,31,31,30,29,30,29,30,30],
  2076:[31,32,31,32,31,30,30,30,29,29,30,30],
  2077:[31,32,31,32,31,30,30,30,29,30,29,31],
  2078:[31,31,31,32,31,31,30,29,30,29,30,30],
  2079:[31,31,32,31,31,31,30,29,30,29,30,30],
  2080:[31,32,31,32,31,30,30,30,29,29,30,30],
  2081:[31,32,31,32,31,30,30,30,29,30,29,31],
  2082:[31,31,32,31,31,31,30,29,30,29,30,30],
  2083:[31,31,32,31,31,31,30,29,30,29,30,30],
  2084:[31,32,31,32,31,30,30,30,29,29,30,31],
  2085:[30,32,31,32,31,30,30,30,29,30,29,31],
  2086:[31,31,32,31,31,31,30,29,30,29,30,30],
  2087:[31,31,32,31,31,31,30,30,29,30,30,30],
  2088:[30,31,32,32,30,31,30,30,29,30,30,30],
  2089:[30,32,31,32,31,30,30,30,29,30,30,30],
};
function daysInBsMonth(year, month) {
  const lengths = BS_MONTH_LENGTHS[year] || BS_MONTH_LENGTHS[2083];
  return lengths[month - 1] || 30;
}

export default function Sales() {
  const { has, canDelete } = useAuth();
  const canCreate = has("sales", "create");
  const canUpdate = has("sales", "update");
  const canDel    = canDelete("sales");

  const [rows, setRows] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [customerFilter, setCustomerFilter] = useState("");
  const [paymentStatusFilter, setPaymentStatusFilter] = useState("");

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
      const [s, c] = await Promise.all([
        api.get("/api/sales"),
        api.get("/api/customers"),
      ]);
      setRows(s.items || []);
      setCustomers(c.items || []);
    } catch (e) {
      setError(e.message || "Failed to load sales");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  /* ---------- Live computed ---------- */
  const computed = useMemo(() => {
    const qty    = num(form.gross_qty);
    const rate   = num(form.rate);
    const total  = qty * rate;
    const report = num(form.report_amount);
    const final  = Math.max(0, total - report);
    const due    = Math.max(0, final - num(form.amount_received));
    return { qty, rate, total, report, final, due };
  }, [form.gross_qty, form.rate, form.report_amount, form.amount_received]);

  /* ---------- BS ↔ AD sync ---------- */
  useEffect(() => {
    if (!showForm) return;
    const y = Number(form.date_bs_year);
    const m = Number(form.date_bs_month);
    const d = Number(form.date_bs_day);
    if (!y || !m || !d) return;
    try {
      const s = bsToAdString({ year: y, month: m, day: d });
      if (s !== form.date_ad) setForm((f) => ({ ...f, date_ad: s }));
    } catch { /* invalid */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.date_bs_year, form.date_bs_month, form.date_bs_day, showForm]);

  /* ---------- Lookups ---------- */
  const customerNameById = useMemo(() => {
    const m = new Map();
    customers.forEach((c) => m.set(c.id, c.name));
    return m;
  }, [customers]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter && r.status !== statusFilter) return false;

      if (paymentStatusFilter) {
        const total = num(r.total);
        const received = num(r.received_amount || 0);
        const due = Math.max(0, total - received);
        if (paymentStatusFilter === "paid"    && due > 0)           return false;
        if (paymentStatusFilter === "partial" && (received <= 0 || due <= 0)) return false;
        if (paymentStatusFilter === "unpaid"  && received > 0)      return false;
      }

      if (customerFilter && String(r.customer_id) !== customerFilter) return false;
      if (!q) return true;
      return (
        (r.invoice || "").toLowerCase().includes(q) ||
        (r.product || "").toLowerCase().includes(q) ||
        (customerNameById.get(r.customer_id) || "").toLowerCase().includes(q)
      );
    });
  }, [rows, search, statusFilter, customerFilter, paymentStatusFilter, customerNameById]);

  const stats = useMemo(() => {
    const invoiced = rows.reduce((s, r) => s + num(r.total), 0);
    const received = rows.reduce((s, r) => s + num(r.received_amount || 0), 0);
    const due      = rows.reduce((s, r) => s + num(r.due_amount || 0), 0);
    const delivered = rows.filter((r) => r.status === "Delivered").length;
    return [
      { label: "Total Sales",      value: rupees(invoiced) },
      { label: "Received",         value: rupees(received) },
      { label: "Due",              value: rupees(due) },
      { label: "Delivered",        value: `${delivered} / ${rows.length}` },
    ];
  }, [rows]);

  /* ---------- Form open/close ---------- */
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

      date_bs_year:  row.date_bs_year  || todayBs.year,
      date_bs_month: row.date_bs_month || todayBs.month,
      date_bs_day:   row.date_bs_day   || todayBs.day,
      date_ad:       row.date_ad ? String(row.date_ad).slice(0, 10) : bsToAdString(todayBs),

      gross_qty: row.gross_qty ?? "",
      dust_qty:  row.dust_qty  ?? "0",
      rate:      row.rate      ?? "",
      report_amount: row.report_amount ?? "0",

      amount_received: "0",
      payment_method: "Cash",
      cash_source: row.cash_source || "",
      received_by: row.received_by || "",
      signature:   row.signature   || "",

      status:  row.status  || "Delivered",
      company: row.company || BRAND,
    });
    setFormError(null);
    setShowForm(true);
  }

  /* ---------- Save ---------- */
  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);

    try {
      const payload = {
        invoice:     form.invoice.trim(),
        customer_id: Number(form.customer_id),
        product:     form.product.trim(),

        date_bs_year:  Number(form.date_bs_year),
        date_bs_month: Number(form.date_bs_month),
        date_bs_day:   Number(form.date_bs_day),
        date_ad:       form.date_ad,

        gross_qty: computed.qty,
        dust_qty:  num(form.dust_qty),
        net_qty:   computed.qty,
        rate:      computed.rate,
        report_amount: computed.report,
        total:     computed.final,

        status:  form.status,
        company: form.company.trim() || undefined,
      };

      if (!editing) {
        payload.amount_received = num(form.amount_received);
        payload.payment_method  = form.payment_method;
        payload.cash_source     = form.cash_source.trim() || undefined;
        payload.received_by     = form.received_by.trim() || undefined;
        payload.signature       = form.signature.trim()   || undefined;
      }

      if (!payload.invoice)      { setFormError("Invoice is required.");             setSaving(false); return; }
      if (!payload.customer_id)  { setFormError("Select a customer.");               setSaving(false); return; }
      if (!payload.product)      { setFormError("Product is required.");             setSaving(false); return; }
      if (payload.gross_qty <= 0){ setFormError("Quantity must be positive.");       setSaving(false); return; }
      if (payload.rate <= 0)     { setFormError("Rate must be positive.");           setSaving(false); return; }

      if (editing) await api.patch(`/api/sales/${editing.id}`, payload);
      else         await api.post("/api/sales", payload);

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

  /* ---------- Print ---------- */
  async function printSaleInvoice(row) {
    const customerName = customerNameById.get(row.customer_id) || "—";
    const company = row.company || BRAND;

    let payments = [];
    try {
      const { items } = await api.get(`/api/sales/${row.id}/payments`);
      payments = items || [];
    } catch { payments = []; }

    const paidTotal = payments.reduce((s, p) => s + num(p.amount), 0);
    const due = Math.max(0, num(row.total) - paidTotal);

    const installmentLines = payments.map((p, i) => `
      <div><span>${esc(p.note || `${ordinal(i + 1)} installment`)}</span><span>${esc(rupees(p.amount))}</span></div>
    `).join("");

    const cust = customers.find((c) => c.id === row.customer_id);
    const custSub = cust
      ? [cust.contact, cust.phone].filter((v) => v && v !== "-" && v !== "Various").join(" · ")
      : "";

    printVoucher(`
      <div class="doc-sheet">
        <div class="doc-letterhead">
          <div class="doc-brand">
            <div class="doc-company">${esc(company)}</div>
          </div>
          <div class="doc-kind">
            <div class="doc-title">Sales Invoice</div>
            <div class="doc-no">No. ${esc(row.invoice)}</div>
          </div>
        </div>

        <div class="doc-meta">
          <div>Date (BS)<strong>${esc(formatBs(row))}</strong></div>
          <div>Date (English)<strong>${esc(adStr(row))}</strong></div>
          <div>Company<strong>${esc(company)}</strong></div>
          <div>Status<strong>${esc(row.status || "Delivered")}</strong></div>
        </div>

        <div class="doc-two-col">
          <div class="doc-box">
            <div class="doc-box-title">Sold To (Customer)</div>
            <div class="doc-box-main">${esc(customerName)}</div>
            ${custSub ? `<div class="doc-box-sub">${esc(custSub)}</div>` : ""}
          </div>
          <div class="doc-box">
            <div class="doc-box-title">Sold By</div>
            <div class="doc-box-main">${esc(company)}</div>
          </div>
        </div>

        <div class="doc-section-title">Product</div>
        <table class="doc-table">
          <thead>
            <tr>
              <th>Product</th>
              <th class="num">Quantity</th>
              <th class="num">Rate / kg</th>
              <th class="num">Total</th>
              <th class="num">Report Amt</th>
              <th class="num">Final Total</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>${esc(row.product || "—")}</td>
              <td class="num">${esc(kg(row.gross_qty))}</td>
              <td class="num">${esc(rupees(row.rate))}</td>
              <td class="num">${esc(rupees(num(row.gross_qty) * num(row.rate)))}</td>
              <td class="num">− ${esc(rupees(row.report_amount || 0))}</td>
              <td class="num">${esc(rupees(row.total))}</td>
            </tr>
          </tbody>
        </table>

        <div class="doc-summary">
          <div><span>Total (Quantity × Rate)</span><span>${esc(rupees(num(row.gross_qty) * num(row.rate)))}</span></div>
          <div><span>Report Amount</span><span>− ${esc(rupees(row.report_amount || 0))}</span></div>
          <div class="doc-summary-strong"><span>Final Total</span><span>${esc(rupees(row.total))}</span></div>
        </div>

        ${payments.length ? `
          <div class="doc-section-title">Payments Received</div>
          <div class="doc-summary">
            ${installmentLines}
            <div class="doc-summary-strong"><span>Total Received</span><span>${esc(rupees(paidTotal))}</span></div>
            <div class="doc-summary-strong"><span>Balance Due</span><span>${esc(rupees(due))}</span></div>
          </div>
        ` : `
          <div class="doc-summary">
            <div class="doc-summary-strong"><span>Balance Due</span><span>${esc(rupees(due))}</span></div>
          </div>
        `}

        <div class="doc-signatures">
          <div>Received By (Customer)</div>
          <div>Authorized By</div>
        </div>

        <div class="doc-foot">
          Printed on ${esc(new Date().toLocaleString())} from ${esc(company)} management system.
        </div>
      </div>`);
  }

  /* ---------- Table columns ---------- */
  const columns = [
    { key: "date_bs", label: "Date (BS)", render: (r) => formatBs(r) },
    { key: "date_ad", label: "Date (EN)", render: (r) => adStr(r) },
    { key: "invoice", label: "Invoice" },
    { key: "customer", label: "Customer",
      render: (r) => customerNameById.get(r.customer_id) || "—" },
    { key: "product", label: "Product" },
    { key: "gross_qty", label: "Qty", numeric: true, render: (r) => kg(r.gross_qty) },
    { key: "rate", label: "Rate", numeric: true, render: (r) => `${rupees(r.rate)}/kg` },
    { key: "total", label: "Final Total", numeric: true, render: (r) => rupees(r.total) },
    { key: "received_amount", label: "Received", numeric: true,
      render: (r) => (
        <span className="text-positive">{rupees(r.received_amount || 0)}</span>
      ) },
    { key: "due_amount", label: "Balance Due", numeric: true,
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
          {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>

        <label htmlFor="sale-status" className="text-xs text-ink-faint pl-1">Status</label>
        <select id="sale-status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className={selectCls + " !w-auto"}>
          <option value="">All</option>
          <option value="Delivered">Delivered</option>
          <option value="Pending">Pending</option>
        </select>

        <label htmlFor="sale-payment" className="text-xs text-ink-faint pl-1">Payment</label>
        <select id="sale-payment" value={paymentStatusFilter} onChange={(e) => setPaymentStatusFilter(e.target.value)}
          className={selectCls + " !w-auto"}>
          <option value="">All</option>
          <option value="paid">Fully Paid</option>
          <option value="partial">Partially Paid</option>
          <option value="unpaid">Unpaid</option>
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
          onRowClick={(row) => setDetail(row)}
          emptyMessage={
            rows.length === 0
              ? (canCreate ? 'No sales yet — click "+ New Sale" to get started.' : "No sales yet.")
              : "No sales match the current filter."
          }
        />
      )}

      {/* Detail modal */}
      {detail && (
        <Modal
          title={`Sale Detail — ${detail.invoice}`}
          onClose={() => setDetail(null)}
          wide
          footer={
            <>
              <Button onClick={() => printSaleInvoice(detail)}>Print</Button>
              <Button onClick={() => setDetail(null)}>Close</Button>
            </>
          }
        >
          <div className="grid grid-cols-2 gap-x-5 gap-y-2.5 mb-4 max-[560px]:grid-cols-1">
            <DetailPair label="Customer" value={customerNameById.get(detail.customer_id) || "—"} />
            <DetailPair label="Company" value={detail.company || "—"} />
            <DetailPair label="Date (BS)" value={formatBs(detail)} />
            <DetailPair label="Date (EN)" value={adStr(detail)} />
            <DetailPair label="Product" value={detail.product || "—"} />
            <DetailPair label="Status" value={detail.status || "—"} />
            <DetailPair label="Quantity" value={kg(detail.gross_qty)} />
            <DetailPair label="Rate" value={`${rupees(detail.rate)}/kg`} />
            <DetailPair label="Total (Qty × Rate)" value={rupees(num(detail.gross_qty) * num(detail.rate))} />
            <DetailPair label="Report Amount" value={rupees(detail.report_amount || 0)} />
            <DetailPair label="Final Total" value={rupees(detail.total)} />
            <DetailPair label="Received So Far"
              value={<span className="text-positive">{rupees(detail.received_amount || 0)}</span>} />
            <DetailPair label="Balance Due"
              value={
                <span className={(detail.due_amount || 0) > 0 ? "text-negative" : "text-ink-faint"}>
                  {rupees(detail.due_amount || 0)}
                </span>
              } />
          </div>
        </Modal>
      )}

      {/* Create / edit modal */}
      {showForm && (
        <Modal
          title={editing ? `Edit Sale — ${editing.invoice}` : "New Sale"}
          onClose={() => setShowForm(false)}
          wide
          footer={
            <>
              <Button onClick={() => setShowForm(false)} disabled={saving}>Cancel</Button>
              {!editing && (
                <Button type="button" disabled={saving}>Save &amp; Add Transport</Button>
              )}
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

            <p className="text-[11.5px] text-ink-faint bg-surface-sunken rounded-sm px-3 py-2 mb-4">
              Sold quantity is deducted automatically from Inventory if the product name matches an existing item.
            </p>

            {/* ============ CUSTOMER + PRODUCT ============ */}
            <div className="grid grid-cols-2 gap-3.5 mb-5 max-[560px]:grid-cols-1">
              <Field label="Customer">
                <select className={selectCls} value={form.customer_id} required
                  onChange={(e) => setForm((f) => ({ ...f, customer_id: e.target.value }))}>
                  <option value="">— select —</option>
                  {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              <Field label="Product">
                <input className={inputCls} value={form.product} required
                  placeholder="e.g. TMT Rod 12mm"
                  onChange={(e) => setForm((f) => ({ ...f, product: e.target.value }))} />
              </Field>
            </div>

            {/* ============ DATE + QTY ============ */}
            <div className="grid grid-cols-2 gap-3.5 mb-5 max-[560px]:grid-cols-1">
              <Field label="Month (BS)">
                <select className={selectCls} value={form.date_bs_month}
                  onChange={(e) => {
                    const m = Number(e.target.value);
                    setForm((f) => {
                      const maxDay = daysInBsMonth(Number(f.date_bs_year), m);
                      return {
                        ...f,
                        date_bs_month: m,
                        date_bs_day: Math.min(Number(f.date_bs_day) || 1, maxDay),
                      };
                    });
                  }}>
                  {NEPALI_MONTHS.map((np, i) => (
                    <option key={i} value={i + 1}>
                      {np} / {NEPALI_MONTHS_EN[i]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Day">
                <select className={selectCls} value={form.date_bs_day}
                  onChange={(e) => setForm((f) => ({ ...f, date_bs_day: Number(e.target.value) }))}>
                  {Array.from(
                    { length: daysInBsMonth(Number(form.date_bs_year), Number(form.date_bs_month)) },
                    (_, i) => i + 1
                  ).map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </Field>

              <Field label="English Date" hint="auto-computed from BS">
                <div className={inputCls + " !bg-surface-sunken text-ink-soft"}>
                  {prettyAd(form.date_ad)}
                </div>
              </Field>
              <Field label="Quantity (kg)">
                <input type="number" min="0" step="0.001" className={inputCls} value={form.gross_qty} required
                  onChange={(e) => setForm((f) => ({ ...f, gross_qty: e.target.value }))} />
              </Field>

              <Field label="Rate (Rs / kg)">
                <input type="number" min="0" step="0.01" className={inputCls} value={form.rate} required
                  onChange={(e) => setForm((f) => ({ ...f, rate: e.target.value }))} />
              </Field>
              <Field label="Total (Quantity × Rate)">
                <div className={inputCls + " !bg-steel-tint !text-steel-dark font-semibold"}>
                  {rupees(computed.total)}
                </div>
              </Field>

              <Field label="Report Amount (Rs)" hint="subtracted from total" span={2}>
                <input type="number" min="0" step="0.01" className={inputCls} value={form.report_amount}
                  onChange={(e) => setForm((f) => ({ ...f, report_amount: e.target.value }))} />
              </Field>

              <Field label="Final Total (Total − Report Amount)" span={2}>
                <div className={inputCls + " !bg-positive-tint !text-positive font-semibold !text-[15px]"}>
                  {rupees(computed.final)}
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
                <div className={inputCls + " !bg-surface-sunken text-ink-soft"}>
                  {BRAND}
                </div>
              </Field>
            </div>

            {/* ============ PAYMENT (CREATE ONLY) ============ */}
            {!editing && (
              <>
                <h4 className="text-[13.5px] font-semibold mb-2 pt-4 border-t border-dashed border-line">
                  Payment (optional)
                </h4>
                <p className="text-[11.5px] text-ink-faint bg-surface-sunken rounded-sm px-3 py-2 mb-4">
                  If the customer pays something right away, enter it here — it's logged as a transaction automatically.
                  Leave at 0 if nothing is received yet. Additional installments can be logged from the Edit view.
                </p>

                <div className="grid grid-cols-2 gap-3.5 mb-3.5 max-[560px]:grid-cols-1">
                  <Field label="Advance Received Now (Rs)">
                    <input type="number" min="0" step="0.01" className={inputCls} value={form.amount_received}
                      onChange={(e) => setForm((f) => ({ ...f, amount_received: e.target.value }))} />
                  </Field>
                  <Field label="Cash / Online">
                    <select className={selectCls} value={form.payment_method}
                      onChange={(e) => setForm((f) => ({ ...f, payment_method: e.target.value }))}>
                      <option value="Cash">Cash</option>
                      <option value="Online">Online</option>
                    </select>
                  </Field>
                  <Field label="Due After This" span={2}>
                    <div className={inputCls + " !bg-steel-tint !text-steel-dark font-semibold"}>
                      {rupees(computed.due)}
                    </div>
                  </Field>
                </div>
              </>
            )}
          </form>

          {editing && (
            <div className="mt-5">
              <CustomerPaymentsBlock
                sale={editing}
                customerName={customerNameById.get(editing.customer_id) || ""}
                onPaid={load}
              />
            </div>
          )}
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

/* ------------------------------------------------------------------------- */
function DetailPair({ label, value }) {
  return (
    <div>
      <div className="text-[11.5px] text-ink-faint mb-0.5">{label}</div>
      <div className="text-[13.5px] font-medium">{value}</div>
    </div>
  );
}

/* -------------------------------------------------------------------------
   CustomerPaymentsBlock — installments log for one sale.
   Writes to the transactions ledger with ref_type='sale', direction='in'.
   Auto-labels: First installment (Advance), Second installment, Third …
   ------------------------------------------------------------------------- */
function CustomerPaymentsBlock({ sale, customerName, onPaid }) {
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
      const { items } = await api.get(`/api/sales/${sale.id}/payments`);
      setPayments(items || []);
    } catch {
      setPayments([]);
    } finally {
      setLoadingPayments(false);
    }
  }
  useEffect(() => { reloadPayments(); /* eslint-disable-next-line */ }, [sale.id]);

  const total       = Number(sale.total || 0);
  const paidSoFar   = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
  const totalDue    = Math.max(0, total - paidSoFar);
  const nextInstallmentNumber = payments.length + 1;

  const bs = {
    year:  sale.date_bs_year  || 2083,
    month: sale.date_bs_month || 1,
    day:   sale.date_bs_day   || 1,
  };
  const ad = sale.date_ad
    ? String(sale.date_ad).slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  async function submit() {
    setErr(null);
    setDone(null);
    const amt = Number(amount);
    if (!amt || amt <= 0) { setErr("Enter an amount greater than zero."); return; }
    setBusy(true);
    try {
      await api.post(`/api/sales/${sale.id}/payments`, {
        amount: amt,
        method,
        note: note.trim() || undefined,
        date_bs_year:  bs.year,
        date_bs_month: bs.month,
        date_bs_day:   bs.day,
        date_ad:       ad,
      });

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
        Payments Received
      </h4>
      <p className="text-[11.5px] text-ink-faint bg-surface-sunken rounded-sm px-3 py-2 mb-4">
        Payments are logged as transactions against this sale. Each additional payment reduces the customer's
        outstanding balance and shows up in the Transactions ledger.
      </p>

      <div className="grid grid-cols-4 gap-3 mb-4 max-[560px]:grid-cols-1">
        <div className="bg-surface-sunken border border-line-soft rounded-sm px-3 py-2">
          <div className="text-[11px] text-ink-faint mb-1">Final Total</div>
          <div className="text-sm font-semibold tabular-nums">{rupees(total)}</div>
        </div>
        <div className="bg-surface-sunken border border-line-soft rounded-sm px-3 py-2">
          <div className="text-[11px] text-ink-faint mb-1">Received so far</div>
          <div className="text-sm font-semibold tabular-nums text-positive">{rupees(paidSoFar)}</div>
        </div>
        <div className="bg-surface-sunken border border-line-soft rounded-sm px-3 py-2">
          <div className="text-[11px] text-ink-faint mb-1">Installments</div>
          <div className="text-sm font-semibold tabular-nums">{payments.length}</div>
        </div>
        <div className="bg-surface-sunken border border-line-soft rounded-sm px-3 py-2">
          <div className="text-[11px] text-ink-faint mb-1">Balance Due</div>
          <div className="text-sm font-semibold tabular-nums text-negative">{rupees(totalDue)}</div>
        </div>
      </div>

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
                placeholder={`Leave blank for "${ordinal(nextInstallmentNumber)} installment"`}
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
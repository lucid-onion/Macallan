/* ==========================================================================
   Sales.jsx — sales register with VAT (13%) block, live weight/rate maths,
   BS↔AD date sync, optional "Payment (optional)" on create, EditPaymentBlock
   on edit, and an A4 print invoice.

   Money math (client-side preview only — server recomputes and overwrites):
     base    = gross_qty × rate                  (dust included)
     report  = dust_qty  × rate                  (dust value)
     vat     = vat_enabled ? base × 0.13 : 0     (13%)
     final   = base + vat − report               (stored as sales.total)
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

  vat_enabled: false,

  amount_received: "0",
  payment_method: "Cash",
  cash_source: "",
  received_by: "",
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
  const [paymentStatusFilter, setPaymentStatusFilter] = useState(""); // "", "paid", "partial", "unpaid"

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

  /* ---------- Live computations (preview) ---------- */
  const computed = useMemo(() => {
    const gross = num(form.gross_qty);
    const dust  = num(form.dust_qty);
    const rate  = num(form.rate);

    const net    = Math.max(0, gross - dust);
    const total  = gross * rate;                          // base, dust included
    const report = dust  * rate;                          // dust value
    const vat    = form.vat_enabled ? total * 0.13 : 0;   // 13%
    const final  = total + vat - report;                  // final total
    const due    = Math.max(0, final - num(form.amount_received));

    return { gross, dust, net, rate, total, report, vat, final, due };
  }, [form.gross_qty, form.dust_qty, form.rate, form.vat_enabled, form.amount_received]);

  /* ---------- BS <-> AD live sync ---------- */
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
    const qty      = rows.reduce((s, r) => s + num(r.net_qty), 0);
    const delivered = rows.filter((r) => r.status === "Delivered").length;
    return [
      { label: "Total Sales",      value: rupees(invoiced) },
      { label: "Received",         value: rupees(received) },
      { label: "Due",              value: rupees(due) },
      { label: "Delivered",        value: `${delivered} / ${rows.length}` },
    ];
  }, [rows]);

  /* ---------- Form actions ---------- */
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

      vat_enabled: Boolean(row.vat_enabled),

      amount_received: "0",
      payment_method: "Cash",
      cash_source: row.cash_source || "",
      received_by: row.received_by || "",
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
        customer_id: Number(form.customer_id),
        product:     form.product.trim(),

        date_bs_year:  Number(form.date_bs_year),
        date_bs_month: Number(form.date_bs_month),
        date_bs_day:   Number(form.date_bs_day),
        date_ad:       form.date_ad,

        gross_qty: computed.gross,
        dust_qty:  computed.dust,
        net_qty:   computed.net,
        rate:      computed.rate,

        // Server recomputes total/vat_amount/report_amount from these, but
        // we send them for consistency if the server ever trusts the client.
        total:         computed.final,
        vat_enabled:   form.vat_enabled,
        vat_amount:    computed.vat,
        report_amount: computed.report,

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
      if (payload.gross_qty <= 0){ setFormError("Gross quantity must be positive."); setSaving(false); return; }
      if (payload.rate <= 0)     { setFormError("Rate must be positive.");           setSaving(false); return; }

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

  /* ---------- Print ---------- */
  async function fetchPaymentsForSale(id) {
    try {
      const { items } = await api.get("/api/transactions");
      return (items || []).filter(
        (t) => t.ref_type === "sale" && Number(t.ref_id) === Number(id)
      );
    } catch {
      return [];
    }
  }

  async function printSaleInvoice(row) {
    const customerName = customerNameById.get(row.customer_id) || "—";
    const payments = await fetchPaymentsForSale(row.id);
    const receivedTotal = payments.reduce((s, p) => s + num(p.amount), 0);
    const due = Math.max(0, num(row.total) - receivedTotal);
    const company = row.company || "ASN Demolition Pvt.Ltd";

    // Invoice math reproduced from stored values.
    const base   = num(row.gross_qty) * num(row.rate);
    const report = num(row.report_amount) || (num(row.dust_qty) * num(row.rate));
    const vat    = num(row.vat_amount);

    const cust = customers.find((c) => c.id === row.customer_id);
    const custSub = cust
      ? [cust.contact, cust.phone].filter((v) => v && v !== "-" && v !== "Various").join(" · ")
      : "";

    let transport = null;
    try {
      const { items } = await api.get("/api/transportation");
      transport = (items || []).find((t) => Number(t.sale_id) === Number(row.id)) || null;
    } catch { /* no transport, fine */ }

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
              <th class="num">Gross Qty</th>
              <th class="num">Dust</th>
              <th class="num">Net Qty</th>
              <th class="num">Rate / kg</th>
              <th class="num">Gross × Rate</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>${esc(row.product || "—")}</td>
              <td class="num">${esc(kg(row.gross_qty))}</td>
              <td class="num">${esc(kg(row.dust_qty))}</td>
              <td class="num">${esc(kg(row.net_qty))}</td>
              <td class="num">${esc(rupees(row.rate))}</td>
              <td class="num">${esc(rupees(base))}</td>
            </tr>
          </tbody>
        </table>

        ${transport ? `
          <div class="doc-section-title">Delivery</div>
          <div class="doc-fields doc-fields-4">
            <div><span>From</span><strong>${esc(transport.from_location || "—")}</strong></div>
            <div><span>To</span><strong>${esc(transport.to_location || "—")}</strong></div>
            <div><span>Vehicle No.</span><strong>${esc(transport.vehicle || "—")}</strong></div>
            <div><span>Driver</span><strong>${esc(transport.driver || "—")}</strong></div>
            <div><span>Driver's Phone</span><strong>${esc(transport.driver_phone || "—")}</strong></div>
            <div><span>Loader</span><strong>${esc(transport.loader || "—")}</strong></div>
            <div><span>Transport Fee</span><strong>${esc(rupees(transport.fee || 0))}</strong></div>
            <div><span>Delivery Status</span><strong>${esc(transport.status || "—")}</strong></div>
          </div>` : ""}

        ${payments.length ? `
          <div class="doc-section-title">Payments Received</div>
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
          <div><span>Total (Gross × Rate)</span><span>${esc(rupees(base))}</span></div>
          ${row.vat_enabled ? `<div><span>VAT (13%)</span><span>${esc(rupees(vat))}</span></div>` : ""}
          <div><span>Report amount (Dust × Rate)</span><span>${esc(rupees(report))}</span></div>
          <div class="doc-summary-strong"><span>Final Total</span><span>${esc(rupees(row.total))}</span></div>
          <div><span>Received</span><span>${esc(rupees(receivedTotal))}</span></div>
          <div class="doc-summary-strong"><span>Balance Due</span><span>${esc(rupees(due))}</span></div>
        </div>

        <div class="doc-signatures">
          <div>Received By (Customer)</div>
          <div>Authorized By</div>
        </div>

        <div class="doc-foot">
          Printed on ${esc(new Date().toLocaleString())} from ${esc(company)} management system.
        </div>
      </div>`;

    printVoucher(html);
  }

  /* ---------- Table columns ---------- */
  const columns = [
    { key: "date_bs", label: "Date (BS)", render: (r) => formatBs(r) },
    { key: "date_ad", label: "Date (EN)", render: (r) => adStr(r) },
    { key: "invoice", label: "Invoice" },
    { key: "customer", label: "Customer",
      render: (r) => customerNameById.get(r.customer_id) || "—" },
    { key: "product", label: "Product" },
    { key: "gross_qty", label: "Gross", numeric: true, render: (r) => kg(r.gross_qty) },
    { key: "dust_qty",  label: "Dust",  numeric: true, render: (r) => kg(r.dust_qty) },
    { key: "net_qty",   label: "Net",   numeric: true, render: (r) => kg(r.net_qty) },
    { key: "rate",      label: "Rate",  numeric: true, render: (r) => `${rupees(r.rate)}/kg` },
    { key: "vat",       label: "VAT",
      render: (r) => r.vat_enabled
        ? <Badge variant="warning">13%</Badge>
        : <span className="text-ink-faint text-[12px]">—</span> },
    { key: "total",     label: "Final Total", numeric: true, render: (r) => rupees(r.total) },
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
        title="Sales"
        description="Every sale — product, weights, rate and customer"
        actions={canCreate ? <Button variant="primary" onClick={openCreate}>+ New Sale</Button> : null}
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
            <DetailPair label="Gross / Dust / Net"
              value={`${kg(detail.gross_qty)} / ${kg(detail.dust_qty)} / ${kg(detail.net_qty)}`} />
            <DetailPair label="Rate" value={`${rupees(detail.rate)}/kg`} />
            <DetailPair label="Gross × Rate"
              value={rupees(num(detail.gross_qty) * num(detail.rate))} />
            <DetailPair label="VAT (13%)"
              value={detail.vat_enabled
                ? <span className="text-warning">{rupees(detail.vat_amount)}</span>
                : <span className="text-ink-faint">Not applied</span>} />
            <DetailPair label="Report (Dust × Rate)"
              value={rupees(detail.report_amount || 0)} />
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
                  onChange={(e) => setForm((f) => ({ ...f, customer_id: e.target.value }))}>
                  <option value="">— select —</option>
                  {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </Field>
              <Field label="Invoice #">
                <input className={inputCls} value={form.invoice} required
                  onChange={(e) => setForm((f) => ({ ...f, invoice: e.target.value }))} />
              </Field>
              <Field label="Product" span={2}>
                <input className={inputCls} value={form.product} required
                  placeholder="e.g. TMT Rod 12mm"
                  onChange={(e) => setForm((f) => ({ ...f, product: e.target.value }))} />
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
                          date_bs_year: bs.year,
                          date_bs_month: bs.month,
                          date_bs_day: bs.day,
                          date_ad: ad,
                        }));
                      }
                    } catch { /* ignore */ }
                  }} />
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
            </div>

            {/* ---- VAT block ---- */}
            <div className="grid grid-cols-2 gap-3.5 mb-5 max-[560px]:grid-cols-1">
              <Field label="Add 13% VAT on this sale" span={2}>
                <label className="flex items-center gap-2.5 text-[13.5px] cursor-pointer select-none py-1">
                  <input
                    type="checkbox"
                    checked={form.vat_enabled}
                    onChange={(e) => setForm((f) => ({ ...f, vat_enabled: e.target.checked }))}
                    className="w-[16px] h-[16px] cursor-pointer"
                  />
                  <span className={form.vat_enabled ? "text-ink font-medium" : "text-ink-faint"}>
                    {form.vat_enabled ? "VAT will be added on this sale" : "No VAT on this sale"}
                  </span>
                </label>
              </Field>

              <Field label="Total (Gross × Rate, dust included)">
                <div className={inputCls + " !bg-surface-sunken font-semibold"}>
                  {rupees(computed.total)}
                </div>
              </Field>
              <Field label="VAT (13%)">
                <div className={inputCls + " !bg-surface-sunken font-semibold" + (form.vat_enabled ? "" : " !text-ink-faint")}>
                  {form.vat_enabled ? rupees(computed.vat) : "—"}
                </div>
              </Field>

              <Field label="Report amount (Dust × Rate)">
                <div className={inputCls + " !bg-warning-tint !text-warning font-semibold"}>
                  {rupees(computed.report)}
                </div>
              </Field>
              <Field label="Final Total (Total + VAT − Report amount)">
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
                <input className={inputCls} value={form.company}
                  onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))} />
              </Field>
            </div>

            {/* ---- Payment (create only) ---- */}
            {!editing && (
              <>
                <h4 className="text-[13.5px] font-semibold mb-2 pt-4 border-t border-dashed border-line">
                  Payment (optional)
                </h4>
                <p className="text-[11.5px] text-ink-faint bg-surface-sunken rounded-sm px-3 py-2 mb-4">
                  If the customer pays something right away, enter it here — it's logged as a transaction automatically.
                  Leave at 0 if nothing is received yet.
                </p>

                <div className="grid grid-cols-2 gap-3.5 mb-3.5 max-[560px]:grid-cols-1">
                  <Field label="Amount Received Now (Rs)">
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
                  <Field label="Paid By (Signature)">
                    <input className={inputCls} value={form.received_by}
                      onChange={(e) => setForm((f) => ({ ...f, received_by: e.target.value }))}
                      placeholder="Who handled the receipt" />
                  </Field>
                  <Field label="Received By (Signature)">
                    <input className={inputCls} value={form.signature}
                      onChange={(e) => setForm((f) => ({ ...f, signature: e.target.value }))}
                      placeholder="Name confirming the slip" />
                  </Field>
                </div>
              </>
            )}
          </form>

          {/* ---- Payment ledger (EDIT only) ---- */}
          {editing && (
            <div className="mt-5">
              <EditPaymentBlock
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
   EditPaymentBlock — payments sub-panel shown inside the Edit Sale modal.
   Unchanged from the previous version.
   ------------------------------------------------------------------------- */
function EditPaymentBlock({ sale, customerName, onPaid }) {
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
          (t) => t.ref_type === "sale" && Number(t.ref_id) === Number(sale.id)
        )
      );
    } catch {
      setPayments([]);
    } finally {
      setLoadingPayments(false);
    }
  }
  useEffect(() => { reloadPayments(); /* eslint-disable-next-line */ }, [sale.id]);

  const receivedSoFar = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
  const total = Number(sale.total || 0);
  const due = Math.max(0, total - receivedSoFar);

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
      const payload = {
        type: "sale_payment",
        party_type: "customer",
        party_key: String(sale.customer_id),
        direction: "in",
        amount: amt,
        method,
        ref_type: "sale",
        ref_id: sale.id,
        date_bs_year:  bs.year,
        date_bs_month: bs.month,
        date_bs_day:   bs.day,
        date_ad:       ad,
        company:       sale.company || undefined,
        note:          note.trim() || "Additional payment",
      };
      if (customerName) payload.party_label = customerName;

      await api.post("/api/transactions", payload);

      setAmount("");
      setNote("");
      setDone(`Received ${amt.toLocaleString("en-IN")} — logged.`);
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
        Payments are separate ledger entries — adding one here doesn't change this sale's amount,
        it just reduces the customer's outstanding balance.
      </p>

      <div className="grid grid-cols-3 gap-3 mb-4 max-[560px]:grid-cols-1">
        <div className="bg-surface-sunken border border-line-soft rounded-sm px-3 py-2">
          <div className="text-[11px] text-ink-faint mb-1">Final Total</div>
          <div className="text-sm font-semibold tabular-nums">{rupees(total)}</div>
        </div>
        <div className="bg-surface-sunken border border-line-soft rounded-sm px-3 py-2">
          <div className="text-[11px] text-ink-faint mb-1">Received so far</div>
          <div className="text-sm font-semibold tabular-nums text-positive">{rupees(receivedSoFar)}</div>
        </div>
        <div className="bg-surface-sunken border border-line-soft rounded-sm px-3 py-2">
          <div className="text-[11px] text-ink-faint mb-1">Balance due</div>
          <div className="text-sm font-semibold tabular-nums text-negative">{rupees(due)}</div>
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
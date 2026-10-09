/* ==========================================================================
   Transportation.jsx — standalone delivery log.

   Each record is a self-contained delivery with:
     - Customer name + invoice ref (free text)
     - Vehicle / driver / loader / route / load / rate
     - Advance + additional payments (installments)

   Money:
     total_amount     = load_kg × rate
     trip_cost        = total_amount + labor + road + tax
     paid_to_driver   = advance + sum(additional payments)
     total_cost_due   = max(0, trip_cost − advance − additional payments)
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

const BRAND = "ScrapLink Pvt.Ltd";
const todayBs = bsToday();

const EMPTY_FORM = {
  customer_name: "",
  invoice:       "",
  vehicle:       "",
  driver:        "",
  driver_phone:  "",
  loader:        "",
  from_location: "",
  to_location:   "",
  load_kg:       "",
  rate:          "",
  advance:       "0",
  labor_charge:  "0",
  road_expense:  "0",
  tax_gbse:      "0",
  date_bs_year:  todayBs.year,
  date_bs_month: todayBs.month,
  date_bs_day:   todayBs.day,
  date_ad:       bsToAdString(todayBs),
  status:        "Delivered",
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

export default function Transportation() {
  const { has, canDelete } = useAuth();
  const canCreate = has("transportation", "create");
  const canUpdate = has("transportation", "update");
  const canDel    = canDelete("transportation");

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);

  const [detail, setDetail] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  async function load() {
    setLoading(true); setError(null);
    try {
      const t = await api.get("/api/transportation");
      setRows(t.items || []);
    } catch (e) {
      setError(e.message || "Failed to load deliveries");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  const computed = useMemo(() => {
    const amount   = num(form.load_kg) * num(form.rate);
    const advance  = num(form.advance);
    const labor    = num(form.labor_charge);
    const road     = num(form.road_expense);
    const tax      = num(form.tax_gbse);
    const balance  = Math.max(0, amount - advance);
    const tripCost = amount + labor + road + tax;
    return { amount, advance, balance, tripCost };
  }, [form.load_kg, form.rate, form.advance, form.labor_charge, form.road_expense, form.tax_gbse]);

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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter && r.status !== statusFilter) return false;
      if (!q) return true;
      return (
        (r.customer_name || "").toLowerCase().includes(q) ||
        (r.invoice || "").toLowerCase().includes(q) ||
        (r.vehicle || "").toLowerCase().includes(q) ||
        (r.driver || "").toLowerCase().includes(q) ||
        (r.loader || "").toLowerCase().includes(q) ||
        (r.from_location || "").toLowerCase().includes(q) ||
        (r.to_location || "").toLowerCase().includes(q)
      );
    });
  }, [rows, search, statusFilter]);

  const stats = useMemo(() => {
    const totalCost = rows.reduce((s, r) => s + num(r.trip_cost ?? r.total_cost), 0);
    const totalLeft = rows.reduce((s, r) => s + num(r.total_balance_due ?? r.balance_due), 0);
    const totalPaid = rows.reduce((s, r) => s + num(r.advance) + num(r.payments_total), 0);
    return [
      { label: "Total Deliveries",  value: String(rows.length) },
      { label: "Total Left to Pay", value: rupees(totalLeft) },
      { label: "Total Paid",        value: rupees(totalPaid) },
      { label: "Total Cost",        value: rupees(totalCost) },
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
      customer_name: row.customer_name || "",
      invoice:       row.invoice || "",
      vehicle:       row.vehicle || "",
      driver:        row.driver || "",
      driver_phone:  row.driver_phone || "",
      loader:        row.loader || "",
      from_location: row.from_location || "",
      to_location:   row.to_location || "",
      load_kg:       row.load_kg ?? "",
      rate:          row.rate ?? "",
      advance:       row.advance ?? "0",
      labor_charge:  row.labor_charge ?? "0",
      road_expense:  row.road_expense ?? "0",
      tax_gbse:      row.tax_gbse ?? "0",
      date_bs_year:  row.date_bs_year  || todayBs.year,
      date_bs_month: row.date_bs_month || todayBs.month,
      date_bs_day:   row.date_bs_day   || todayBs.day,
      date_ad:       row.date_ad ? String(row.date_ad).slice(0, 10) : bsToAdString(todayBs),
      status:        row.status || "Delivered",
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
        customer_name: form.customer_name.trim() || null,
        invoice:       form.invoice.trim()       || null,
        vehicle:       form.vehicle.trim()       || undefined,
        driver:        form.driver.trim()        || undefined,
        driver_phone:  form.driver_phone.trim()  || undefined,
        loader:        form.loader.trim()        || undefined,
        from_location: form.from_location.trim() || undefined,
        to_location:   form.to_location.trim()   || undefined,
        load_kg:       num(form.load_kg),
        rate:          num(form.rate),
        advance:       num(form.advance),
        labor_charge:  num(form.labor_charge),
        road_expense:  num(form.road_expense),
        tax_gbse:      num(form.tax_gbse),
        date_bs_year:  Number(form.date_bs_year),
        date_bs_month: Number(form.date_bs_month),
        date_bs_day:   Number(form.date_bs_day),
        date_ad:       form.date_ad,
        status:        form.status,
      };

      if (editing) await api.patch(`/api/transportation/${editing.id}`, payload);
      else         await api.post("/api/transportation", payload);

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

  async function printTransportVoucher(row) {
    const company = BRAND;

    let payments = [];
    try {
      const { items } = await api.get(`/api/transportation/${row.id}/payments`);
      payments = items || [];
    } catch { payments = []; }

    const installmentLines = [
      { label: "First installment (Advance)", amount: num(row.advance || 0) },
      ...payments.map((p, i) => ({
        label: p.note || `${ordinal(i + 2)} installment`,
        amount: num(p.amount),
      })),
    ].filter((l) => l.amount > 0);

    const totalPaid = installmentLines.reduce((s, l) => s + l.amount, 0);
    const tripCost  = num(row.trip_cost ?? row.total_cost);
    const totalCostDue = Math.max(0, tripCost - totalPaid);

    const installmentRows = installmentLines.map((l, i) => `
      <div>
        <span>${i + 1}. ${esc(l.label)}</span>
        <span>${esc(rupees(l.amount))}</span>
      </div>
    `).join("");

    printVoucher(`
      <div class="doc-sheet">
        <div class="doc-letterhead">
          <div class="doc-brand">
            <div class="doc-company">${esc(company)}</div>
          </div>
          <div class="doc-kind">
            <div class="doc-title">Transportation Voucher</div>
            <div class="doc-no">No. T-${esc(row.id)}</div>
          </div>
        </div>

        <div class="doc-meta">
          <div>Date (BS)<strong>${esc(formatBs(row))}</strong></div>
          <div>Date (English)<strong>${esc(adStr(row))}</strong></div>
          <div>Customer<strong>${esc(row.customer_name || "—")}</strong></div>
          <div>Invoice<strong>${esc(row.invoice || "—")}</strong></div>
        </div>

        <div class="doc-two-col">
          <div class="doc-box">
            <div class="doc-box-title">Customer</div>
            <div class="doc-box-main">${esc(row.customer_name || "—")}</div>
            ${row.invoice ? `<div class="doc-box-sub">Invoice: ${esc(row.invoice)}</div>` : ""}
          </div>
          <div class="doc-box">
            <div class="doc-box-title">Route</div>
            <div class="doc-box-main">${esc(row.from_location || "—")} → ${esc(row.to_location || "—")}</div>
          </div>
        </div>

        <div class="doc-section-title">Truck &amp; Delivery</div>
        <div class="doc-fields doc-fields-4">
          <div><span>Vehicle No.</span><strong>${esc(row.vehicle || "—")}</strong></div>
          <div><span>Driver</span><strong>${esc(row.driver || "—")}</strong></div>
          <div><span>Driver Phone</span><strong>${esc(row.driver_phone || "—")}</strong></div>
          <div><span>Loader</span><strong>${esc(row.loader || "—")}</strong></div>
          <div><span>Load</span><strong>${esc(kg(row.load_kg))}</strong></div>
          <div><span>Rate / kg</span><strong>${esc(rupees(row.rate))}</strong></div>
          <div><span>Total Amount</span><strong>${esc(rupees(row.amount))}</strong></div>
          <div><span>Status</span><strong>${esc(row.status || "—")}</strong></div>
        </div>

        <div class="doc-summary">
          <div><span>Total Amount (load × rate)</span><span>${esc(rupees(row.amount))}</span></div>
          <div><span>Labor Charge</span><span>${esc(rupees(row.labor_charge || 0))}</span></div>
          <div><span>Road Expenses</span><span>${esc(rupees(row.road_expense || 0))}</span></div>
          <div><span>Tax (G.B.S.E)</span><span>${esc(rupees(row.tax_gbse || 0))}</span></div>
          <div class="doc-summary-strong"><span>Total Cost</span><span>${esc(rupees(tripCost))}</span></div>
        </div>

        ${installmentLines.length ? `
          <div class="doc-section-title">Installments Paid</div>
          <div class="doc-summary">
            ${installmentRows}
            <div class="doc-summary-strong"><span>Total Paid</span><span>${esc(rupees(totalPaid))}</span></div>
            <div class="doc-summary-strong"><span>Total Cost Due</span><span>${esc(rupees(totalCostDue))}</span></div>
          </div>
        ` : `
          <div class="doc-summary">
            <div class="doc-summary-strong"><span>Total Cost Due</span><span>${esc(rupees(totalCostDue))}</span></div>
          </div>
        `}

        <div class="doc-signatures">
          <div>Received By</div>
          <div>Authorized By</div>
        </div>

        <div class="doc-foot">
          Printed on ${esc(new Date().toLocaleString())} from ${esc(company)} management system.
        </div>
      </div>`);
  }

  const columns = [
    { key: "date_bs", label: "Date (BS)", render: (r) => formatBs(r) },
    { key: "date_ad", label: "Date (EN)", render: (r) => adStr(r) },
    { key: "customer_name", label: "Customer",
      render: (r) => r.customer_name || "—" },
    { key: "invoice", label: "Invoice",
      render: (r) => r.invoice || "—" },
    { key: "vehicle", label: "Vehicle", render: (r) => r.vehicle || "—" },
    { key: "driver", label: "Driver", render: (r) => r.driver || "—" },
    { key: "driver_phone", label: "Driver Phone", render: (r) => r.driver_phone || "—" },
    { key: "loader", label: "Loader", render: (r) => r.loader || "—" },
    { key: "route", label: "Route",
      render: (r) => `${r.from_location || "—"} → ${r.to_location || "—"}` },
    { key: "load_kg", label: "Load", numeric: true,
      render: (r) => (r.load_kg != null ? kg(r.load_kg) : "—") },
    { key: "rate", label: "Rate", numeric: true,
      render: (r) => r.rate ? `${rupees(r.rate)}/kg` : "—" },
    { key: "amount", label: "Amount", numeric: true,
      render: (r) => rupees(r.amount) },
    { key: "advance", label: "Advance", numeric: true,
      render: (r) => rupees(r.advance || 0) },
    { key: "total_balance_due", label: "Total Due", numeric: true,
      render: (r) => {
        const d = r.total_balance_due ?? r.balance_due ?? 0;
        return <span className={d > 0 ? "text-negative" : "text-ink-faint"}>{rupees(d)}</span>;
      } },
    { key: "total_cost", label: "Total Cost", numeric: true,
      render: (r) => rupees(r.trip_cost ?? r.total_cost) },
    { key: "status", label: "Status",
      render: (r) => (
        <Badge variant={r.status === "Delivered" ? "positive" : "neutral"}>{r.status}</Badge>
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
          placeholder="Customer, invoice, vehicle, driver, route" className={inputCls + " !w-64"} />

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
          onRowClick={(row) => setDetail(row)}
          emptyMessage={
            rows.length === 0
              ? (canCreate ? 'No deliveries yet — click "+ New Delivery" to get started.' : "No deliveries yet.")
              : "No deliveries match the current filter."
          }
        />
      )}

      {detail && (
        <Modal
          title={`Delivery Detail — ${detail.vehicle || "—"}`}
          onClose={() => setDetail(null)}
          wide
          footer={
            <>
              <Button onClick={() => printTransportVoucher(detail)}>Print</Button>
              <Button onClick={() => setDetail(null)}>Close</Button>
            </>
          }
        >
          <div className="grid grid-cols-2 gap-x-5 gap-y-2.5 mb-4 max-[560px]:grid-cols-1">
            <DetailPair label="Customer" value={detail.customer_name || "—"} />
            <DetailPair label="Invoice" value={detail.invoice || "—"} />
            <DetailPair label="Date (BS)" value={formatBs(detail)} />
            <DetailPair label="Date (EN)" value={adStr(detail)} />
            <DetailPair label="Vehicle No." value={detail.vehicle || "—"} />
            <DetailPair label="Driver" value={detail.driver || "—"} />
            <DetailPair label="Driver Phone" value={detail.driver_phone || "—"} />
            <DetailPair label="Loader" value={detail.loader || "—"} />
            <DetailPair label="From" value={detail.from_location || "—"} />
            <DetailPair label="To" value={detail.to_location || "—"} />
            <DetailPair label="Load" value={kg(detail.load_kg)} />
            <DetailPair label="Rate" value={`${rupees(detail.rate)}/kg`} />
            <DetailPair label="Total Amount" value={rupees(detail.amount)} />
            <DetailPair label="Labor Charge" value={rupees(detail.labor_charge || 0)} />
            <DetailPair label="Road Expenses" value={rupees(detail.road_expense || 0)} />
            <DetailPair label="Tax (G.B.S.E)" value={rupees(detail.tax_gbse || 0)} />
            <DetailPair label="Total Cost" value={rupees(detail.trip_cost ?? detail.total_cost)} />
            <DetailPair label="Advance" value={rupees(detail.advance || 0)} />
            <DetailPair label="Additional Payments" value={rupees(detail.payments_total || 0)} />
            <DetailPair label="Total Cost Due"
              value={rupees(detail.total_balance_due ?? detail.balance_due ?? 0)} />
            <DetailPair label="Status" value={detail.status || "—"} />
          </div>
        </Modal>
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

            <h4 className="text-[13.5px] font-semibold mb-3">Customer</h4>
            <div className="grid grid-cols-2 gap-3.5 mb-5 max-[560px]:grid-cols-1">
              <Field label="Customer" span={2}>
                <input className={inputCls} value={form.customer_name}
                  onChange={(e) => setForm((f) => ({ ...f, customer_name: e.target.value }))}
                  placeholder="Customer / company name" />
              </Field>
              <Field label="Invoice" span={2}>
                <input className={inputCls} value={form.invoice}
                  onChange={(e) => setForm((f) => ({ ...f, invoice: e.target.value }))}
                  placeholder="Invoice / bill no." />
              </Field>
            </div>

            <h4 className="text-[13.5px] font-semibold mb-3 pt-4 border-t border-dashed border-line">
              Route &amp; Vehicle
            </h4>
            <div className="grid grid-cols-2 gap-3.5 mb-5 max-[560px]:grid-cols-1">
              <Field label="Vehicle No.">
                <input className={inputCls} value={form.vehicle}
                  onChange={(e) => setForm((f) => ({ ...f, vehicle: e.target.value }))}
                  placeholder="BA 1 KHA 1234" />
              </Field>
              <Field label="Driver Name">
                <input className={inputCls} value={form.driver}
                  onChange={(e) => setForm((f) => ({ ...f, driver: e.target.value }))} />
              </Field>
              <Field label="Driver Phone">
                <input className={inputCls} value={form.driver_phone}
                  inputMode="numeric" maxLength={10}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, "").slice(0, 10);
                    setForm((f) => ({ ...f, driver_phone: digits }));
                  }}
                  placeholder="98XXXXXXXX" />
              </Field>
              <Field label="Loader">
                <input className={inputCls} value={form.loader}
                  onChange={(e) => setForm((f) => ({ ...f, loader: e.target.value }))} />
              </Field>
              <Field label="From">
                <input className={inputCls} value={form.from_location}
                  onChange={(e) => setForm((f) => ({ ...f, from_location: e.target.value }))}
                  placeholder="Yard / warehouse" />
              </Field>
              <Field label="To">
                <input className={inputCls} value={form.to_location}
                  onChange={(e) => setForm((f) => ({ ...f, to_location: e.target.value }))}
                  placeholder="Destination" />
              </Field>
              <Field label="Load (kg)">
                <input type="number" min="0" step="0.001" className={inputCls} value={form.load_kg}
                  onChange={(e) => setForm((f) => ({ ...f, load_kg: e.target.value }))} />
              </Field>
              <Field label="Rate (Rs / kg)">
                <input type="number" min="0" step="0.01" className={inputCls} value={form.rate}
                  onChange={(e) => setForm((f) => ({ ...f, rate: e.target.value }))} />
              </Field>
              <Field label="Total Amount (load × rate)">
                <div className={inputCls + " !bg-steel-tint !text-steel-dark font-semibold"}>
                  {rupees(computed.amount)}
                </div>
              </Field>
              <Field label="Status">
                <select className={selectCls} value={form.status}
                  onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
                  <option value="Delivered">Delivered</option>
                  <option value="In Transit">In Transit</option>
                </select>
              </Field>
            </div>

            <h4 className="text-[13.5px] font-semibold mb-3 pt-4 border-t border-dashed border-line">
              Dates
            </h4>
            <div className="grid grid-cols-2 gap-3.5 mb-5 max-[560px]:grid-cols-1">
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
            </div>

            <h4 className="text-[13.5px] font-semibold mb-3 pt-4 border-t border-dashed border-line">
              Costs
            </h4>
            <div className="grid grid-cols-2 gap-3.5 mb-5 max-[560px]:grid-cols-1">
              <Field label="Driver Advance (Rs)" hint="subtracted from total cost">
                <input type="number" min="0" step="0.01" className={inputCls} value={form.advance}
                  onChange={(e) => setForm((f) => ({ ...f, advance: e.target.value }))} />
              </Field>
              <Field label="Balance after Advance" hint="amount − advance">
                <div className={inputCls + " !bg-steel-tint !text-steel-dark font-semibold"}>
                  {rupees(computed.balance)}
                </div>
              </Field>
              <Field label="Labor Charge (Rs)">
                <input type="number" min="0" step="0.01" className={inputCls} value={form.labor_charge}
                  onChange={(e) => setForm((f) => ({ ...f, labor_charge: e.target.value }))} />
              </Field>
              <Field label="Road Expense (Rs)">
                <input type="number" min="0" step="0.01" className={inputCls} value={form.road_expense}
                  onChange={(e) => setForm((f) => ({ ...f, road_expense: e.target.value }))} />
              </Field>
              <Field label="Tax G.B.S.E (Rs)">
                <input type="number" min="0" step="0.01" className={inputCls} value={form.tax_gbse}
                  onChange={(e) => setForm((f) => ({ ...f, tax_gbse: e.target.value }))} />
              </Field>
              <Field label="Total Cost" hint="amount + labor + road + tax">
                <div className={inputCls + " !bg-positive-tint !text-positive font-semibold"}>
                  {rupees(computed.tripCost)}
                </div>
              </Field>
            </div>
          </form>

          {editing && (
            <div className="mt-5">
              <DriverPaymentsBlock
                transport={editing}
                onPaid={async () => {
                  setShowForm(false);
                  await load();
                }}
              />
            </div>
          )}
        </Modal>
      )}

      {toDelete && (
        <ConfirmDialog
          title="Delete delivery?"
          message="Delete this delivery record? This can't be undone."
          onCancel={() => setToDelete(null)}
          onConfirm={confirmDelete}
          busy={deleting}
        />
      )}
    </>
  );
}

function DetailPair({ label, value }) {
  return (
    <div>
      <div className="text-[11.5px] text-ink-faint mb-0.5">{label}</div>
      <div className="text-[13.5px] font-medium">{value}</div>
    </div>
  );
}

/* DriverPaymentsBlock — installments log */
function DriverPaymentsBlock({ transport, onPaid }) {
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
      const { items } = await api.get(`/api/transportation/${transport.id}/payments`);
      setPayments(items || []);
    } catch {
      setPayments([]);
    } finally {
      setLoadingPayments(false);
    }
  }
  useEffect(() => { reloadPayments(); /* eslint-disable-next-line */ }, [transport.id]);

  const totalAmount = Number(transport.amount        || 0);
  const advance     = Number(transport.advance       || 0);
  const labor       = Number(transport.labor_charge  || 0);
  const road        = Number(transport.road_expense  || 0);
  const tax         = Number(transport.tax_gbse      || 0);
  const paidSoFar   = payments.reduce((s, p) => s + Number(p.amount || 0), 0);

  const tripCost     = totalAmount + labor + road + tax;
  const totalCostDue = Math.max(0, tripCost - advance - paidSoFar);

  const nextInstallmentNumber = payments.length + 2;

  const bs = {
    year:  transport.date_bs_year  || 2083,
    month: transport.date_bs_month || 1,
    day:   transport.date_bs_day   || 1,
  };
  const ad = transport.date_ad
    ? String(transport.date_ad).slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  async function submit() {
    setErr(null);
    setDone(null);
    const amt = Number(amount);
    if (!amt || amt <= 0) { setErr("Enter an amount greater than zero."); return; }
    setBusy(true);
    try {
      await api.post(`/api/transportation/${transport.id}/payments`, {
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
        Payments to Driver
      </h4>
      <p className="text-[11.5px] text-ink-faint bg-surface-sunken rounded-sm px-3 py-2 mb-4">
        Additional payments on top of the advance. These don't hit the transactions ledger —
        they live only on this delivery, so you can track what's been paid to the driver.
      </p>

      <div className="grid grid-cols-4 gap-3 mb-4 max-[560px]:grid-cols-1">
        <div className="bg-surface-sunken border border-line-soft rounded-sm px-3 py-2">
          <div className="text-[11px] text-ink-faint mb-1">Total Amount</div>
          <div className="text-sm font-semibold tabular-nums">{rupees(totalAmount)}</div>
        </div>
        <div className="bg-surface-sunken border border-line-soft rounded-sm px-3 py-2">
          <div className="text-[11px] text-ink-faint mb-1">Advance</div>
          <div className="text-sm font-semibold tabular-nums">{rupees(advance)}</div>
        </div>
        <div className="bg-surface-sunken border border-line-soft rounded-sm px-3 py-2">
          <div className="text-[11px] text-ink-faint mb-1">Paid later</div>
          <div className="text-sm font-semibold tabular-nums text-positive">{rupees(paidSoFar)}</div>
        </div>
        <div className="bg-surface-sunken border border-line-soft rounded-sm px-3 py-2">
          <div className="text-[11px] text-ink-faint mb-1">Total Cost Due</div>
          <div className="text-sm font-semibold tabular-nums text-negative">{rupees(totalCostDue)}</div>
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